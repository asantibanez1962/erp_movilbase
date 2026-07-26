import { Q } from "@nozbe/watermelondb";
// `expo-file-system/legacy` y no `expo-file-system`: en SDK 54 la API vieja
// (deleteAsync y compañía) quedó deprecada en favor de las clases File/Directory,
// y el import raíz avisa por consola en cada llamada. El path legacy es el
// migration path que documenta Expo y evita el ruido sin reescribir nada.
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import type { PushResponse } from "@erp/shared-types";
import { database } from "./db";
import { getHttpClient } from "./api";
import { contextoActual } from "./sesion";
import { PendingUpload, ServerId } from "../db/models";

/**
 * Fotos de la visita.
 *
 * No viajan por el sync: el contrato es JSON y no transporta binarios. Van al
 * endpoint de attachments que ya existe en el platform:
 *
 *   POST /attachments/Visita/{serverId}   multipart(file, notes)
 *
 * El recordKey tiene que ser el id NUMÉRICO del servidor, que no existe hasta que
 * el push de la visita fue aceptado. De ahí la cola: la foto se guarda en el
 * filesystem al tomarla y se sube después, cuando ya se puede resolver el id.
 *
 * La cola vive en `pending_uploads` y el mapeo en `server_ids`; ninguna de las dos
 * está en COLLECTIONS, así que nunca se pushean.
 */

/** Ancho máximo. 1280px es legible para una foto de finca y baja ~10x el peso. */
const MAX_ANCHO = 1280;
const CALIDAD_JPEG = 0.7;

/**
 * Redimensiona + comprime la foto y la encola contra la visita. La conexión en
 * campo es 3G rural o peor: subir el original de 12 MP haría fallar el upload por
 * timeout una y otra vez.
 */
export async function encolarFoto(
  visitaLocalId: string,
  uriOriginal: string
): Promise<void> {
  const comprimida = await ImageManipulator.manipulateAsync(
    uriOriginal,
    [{ resize: { width: MAX_ANCHO } }],
    { compress: CALIDAD_JPEG, format: ImageManipulator.SaveFormat.JPEG }
  );

  await database.write(async () => {
    await database.get<PendingUpload>("pending_uploads").create((rec) => {
      rec.visitaLocalId = visitaLocalId;
      rec.fileUri = comprimida.uri;
      rec.status = "pending";
      rec.error = null;
      rec.createdAt = Date.now();
    });
  });
}

/** Todas las fotos locales de una visita: las que faltan subir y las ya subidas. */
export async function fotosLocalesDe(
  visitaLocalId: string
): Promise<PendingUpload[]> {
  return database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("visita_local_id", visitaLocalId), Q.sortBy("created_at", Q.asc))
    .fetch();
}

/**
 * Fotos de la visita que están en el SERVIDOR. Sirve para dos casos que la copia
 * local no cubre: las que subió otro dispositivo o la oficina, y las propias cuya
 * copia local ya purgó por antigüedad.
 *
 * Requiere conexión; sin ella se devuelve vacío y la pantalla muestra sólo lo local.
 */
export interface FotoServidor {
  id: number;
  fileName: string;
  sizeBytes: number;
}

export async function fotosDelServidor(
  visitaLocalId: string
): Promise<FotoServidor[]> {
  const serverId = await resolverServerId(visitaLocalId);
  if (serverId == null) return [];

  try {
    const http = getHttpClient();
    const resp = await http.get<Array<{ id: number; fileName: string; sizeBytes: number }>>(
      `/attachments/Visita/${serverId}`,
      { headers: { "X-Company-Id": String(contextoActual().companyId) } }
    );
    return resp.data ?? [];
  } catch (e) {
    // Sin señal es lo esperado en campo, no un error que valga mostrar.
    console.info("no se pudieron listar las fotos del servidor", (e as Error)?.message);
    return [];
  }
}

/**
 * Borra las copias LOCALES de fotos ya subidas que pasaron su plazo de retención.
 *
 * Se conservan un tiempo para que el promotor pueda verlas sin señal; después se
 * liberan (~190 KB cada una) y, si vuelve a abrir esa visita con conexión, se
 * traen del servidor. La foto en el ERP no se toca nunca: es parte del expediente.
 *
 * `dias` viene de la config del servidor (Mobile:RetencionFotosLocalesDias), no
 * hardcodeada, para poder ajustarla por instalación sin republicar el APK.
 */
export async function purgarFotosLocales(dias: number): Promise<number> {
  if (!Number.isFinite(dias) || dias <= 0) return 0;

  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const viejas = await database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("status", "subida"), Q.where("subida_at", Q.lt(corte)))
    .fetch();
  if (viejas.length === 0) return 0;

  const uris = viejas.map((f) => f.fileUri);
  await database.write(async () => {
    for (const f of viejas) await f.destroyPermanently();
  });

  for (const uri of uris) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Archivo ya borrado o inaccesible: la fila igual se fue, que es lo que importa.
    }
  }
  return viejas.length;
}

/**
 * Guarda las traducciones localId → serverId de las filas que el push acaba de
 * aceptar. Se llama después de cada sync.
 *
 * Persistirlas es lo que permite subir una foto que se sacó DESPUÉS de haber
 * sincronizado la visita: en ese sync posterior la visita ya no aparece en
 * accepted[], y la primera versión —que sólo miraba ahí— dejaba la foto encolada
 * para siempre.
 */
export async function registrarServerIds(
  pushResponses: Record<string, PushResponse>
): Promise<void> {
  const nuevos: Array<{ coleccion: string; localId: string; serverId: string }> = [];

  for (const [coleccion, resp] of Object.entries(pushResponses)) {
    for (const fila of resp.accepted?.[coleccion] ?? []) {
      nuevos.push({ coleccion, localId: fila.local_id, serverId: fila.server_id });
    }
  }
  if (nuevos.length === 0) return;

  const tabla = database.get<ServerId>("server_ids");
  await database.write(async () => {
    for (const n of nuevos) {
      // Idempotente: si el device reintenta un push ya aceptado, no duplicamos.
      const existe = await tabla
        .query(Q.where("coleccion", n.coleccion), Q.where("local_id", n.localId))
        .fetchCount();
      if (existe > 0) continue;

      await tabla.create((rec) => {
        rec.coleccion = n.coleccion;
        rec.localId = n.localId;
        rec.serverId = n.serverId;
        rec.createdAt = Date.now();
      });
    }
  });
}

/**
 * Id de servidor de una visita, o null si todavía no se puede saber.
 *
 * Tres casos, en orden:
 *   1. el id local ya ES numérico → la visita vino de un pull sin ClientUuid
 *      (creada en la web), así que el id local es el del servidor
 *   2. hay mapeo en server_ids → la creó este teléfono y ya subió
 *   3. nada → la visita no se sincronizó todavía; la foto sigue esperando
 */
async function resolverServerId(visitaLocalId: string): Promise<string | null> {
  if (/^\d+$/.test(visitaLocalId)) return visitaLocalId;

  const fila = await database
    .get<ServerId>("server_ids")
    .query(Q.where("coleccion", "visitas"), Q.where("local_id", visitaLocalId))
    .fetch();

  return fila.length > 0 ? fila[0]!.serverId : null;
}

/**
 * Sube todas las fotos encoladas que ya tengan a dónde ir.
 *
 * Recorre la cola completa, no sólo lo aceptado en este sync: es lo que hace que
 * funcione el caso normal (sacar la foto después de sincronizar la visita) y que
 * un upload fallido se reintente en el próximo sync.
 */
export async function flushPendingUploads(): Promise<void> {
  const pendientes = await database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("status", Q.notEq("subida")))
    .fetch();
  if (pendientes.length === 0) return;

  const http = getHttpClient();

  for (const foto of pendientes) {
    const serverId = await resolverServerId(foto.visitaLocalId);
    // Visita sin sincronizar: se deja en la cola, sin marcarla como error.
    if (serverId == null) continue;

    const uri = foto.fileUri;
    const nombre = `visita-${serverId}-${foto.id}.jpg`;

    try {
      await subirFoto(http, serverId, uri, nombre);
    } catch (err) {
      // Falló la subida de verdad → queda en cola con el motivo, para reintentar.
      const mensaje = err instanceof Error ? err.message : String(err);
      await database.write(async () => {
        await foto.update((rec) => {
          rec.status = "error";
          rec.error = mensaje;
        });
      });
      continue;
    }

    // Subida OK. La fila NO se destruye ni se borra el archivo: la copia local se
    // conserva para poder ver la foto sin señal al reentrar a la visita. La
    // libera después la purga, pasado el plazo de retención.
    //
    // Desde acá nada puede "fallar el upload": la foto ya está en el servidor y
    // volver a marcarla como error la haría subir dos veces.
    await database.write(async () => {
      await foto.update((rec) => {
        rec.status = "subida";
        rec.error = null;
        rec.subidaAt = Date.now();
      });
    });
  }
}

async function subirFoto(
  http: ReturnType<typeof getHttpClient>,
  serverId: string,
  uri: string,
  nombre: string
): Promise<void> {
  const form = new FormData();
  // RN acepta este shape (uri/name/type) donde el DOM esperaría un Blob.
  form.append("file", {
    uri,
    name: nombre,
    type: "image/jpeg",
  } as unknown as Blob);
  form.append("notes", "Foto de visita de campo (app promotor)");

  await http.post(`/attachments/Visita/${serverId}`, form, {
    headers: {
      "Content-Type": "multipart/form-data",
      "X-Company-Id": String(contextoActual().companyId),
    },
  });
}
