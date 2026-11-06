import { Q } from "@nozbe/watermelondb";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import type { PushResponse } from "@erp/shared-types";
import { database } from "./db";
import { getHttpClient } from "./api";
import { contextoActual, useSesion } from "./sesion";
import { entidadDe } from "./politicas";
import { PendingUpload, ServerId } from "../db/models";

/**
 * Adjuntos de cualquier registro creado en el teléfono.
 *
 * No viajan por el sync: el contrato es JSON y no transporta binarios. Van al
 * endpoint genérico que ya existe en el platform:
 *
 *   POST /attachments/{EntityName}/{serverId}   multipart(file, notes)
 *
 * El recordKey tiene que ser el id NUMÉRICO del servidor, que no existe hasta que
 * el push del registro fue aceptado. De ahí la cola: el archivo se guarda en el
 * filesystem al capturarlo y se sube después, cuando el id se puede resolver.
 *
 * Genérico por (coleccion, registroLocalId) — fotos de una visita, cédula de una
 * solicitud, lo que venga. El EntityName sale del manifest, no de un mapa
 * hardcodeado acá.
 *
 * `pending_uploads` y `server_ids` son tablas WMDB locales que NO están en
 * COLLECTIONS: nunca se pushean.
 */

/** Ancho máximo. 1280px es legible para una foto de finca o una cédula. */
const MAX_ANCHO = 1280;
const CALIDAD_JPEG = 0.7;

/**
 * Redimensiona, comprime y encola el adjunto. La conexión en campo es 3G rural o
 * peor: subir el original de 12 MP haría fallar el upload por timeout una y otra vez.
 */
export async function encolarAdjunto(
  coleccion: string,
  registroLocalId: string,
  uriOriginal: string
): Promise<void> {
  const comprimida = await ImageManipulator.manipulateAsync(
    uriOriginal,
    [{ resize: { width: MAX_ANCHO } }],
    { compress: CALIDAD_JPEG, format: ImageManipulator.SaveFormat.JPEG }
  );

  await database.write(async () => {
    await database.get<PendingUpload>("pending_uploads").create((rec) => {
      rec.coleccion = coleccion;
      rec.registroLocalId = registroLocalId;
      rec.fileUri = comprimida.uri;
      rec.status = "pending";
      rec.error = null;
      rec.createdAt = Date.now();
    });
  });
}

/** Adjuntos locales de un registro: los que faltan subir y los ya subidos. */
export async function adjuntosLocalesDe(
  coleccion: string,
  registroLocalId: string
): Promise<PendingUpload[]> {
  return database
    .get<PendingUpload>("pending_uploads")
    .query(
      Q.where("coleccion", coleccion),
      Q.where("registro_local_id", registroLocalId),
      Q.sortBy("created_at", Q.asc)
    )
    .fetch();
}

export interface AdjuntoServidor {
  id: number;
  fileName: string;
  sizeBytes: number;
}

/**
 * Adjuntos que están en el SERVIDOR. Cubre dos casos que la copia local no: los
 * que subió otro dispositivo o la oficina, y los propios cuya copia local ya
 * purgó por antigüedad.
 *
 * Requiere conexión; sin ella devuelve vacío y la pantalla muestra sólo lo local.
 */
export async function adjuntosDelServidor(
  coleccion: string,
  registroLocalId: string
): Promise<AdjuntoServidor[]> {
  const serverId = await resolverServerId(coleccion, registroLocalId);
  if (serverId == null) return [];

  const entidad = entidadDe(useSesion.getState().politicas, coleccion);
  if (!entidad) return [];

  try {
    const http = getHttpClient();
    const resp = await http.get<AdjuntoServidor[]>(
      `/attachments/${entidad}/${serverId}`,
      { headers: { "X-Company-Id": String(contextoActual().companyId) } }
    );
    return resp.data ?? [];
  } catch (e) {
    // Sin señal es lo esperado en campo, no un error que valga mostrar.
    console.info("no se pudieron listar los adjuntos del servidor", (e as Error)?.message);
    return [];
  }
}

/**
 * Guarda las traducciones localId → serverId de las filas que el push acaba de
 * aceptar. Se llama después de cada sync.
 *
 * Persistirlas es lo que permite subir un adjunto capturado DESPUÉS de haber
 * sincronizado su registro: en ese sync posterior el registro ya no aparece en
 * accepted[], y la primera versión —que sólo miraba ahí— dejaba el archivo
 * encolado para siempre.
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
 * Id de servidor de un registro, o null si todavía no se puede saber.
 *
 * Cuatro casos, en orden:
 *   1. la fila trae `server_id` del pull (v1.53/RC/54) → es el más confiable, y el
 *      ÚNICO que cubre una fila bajada del servidor que este teléfono nunca pusheó.
 *      En un dispositivo recién instalado son todas: sin esto, los adjuntos sobre
 *      cualquier registro anterior se quedaban en la cola para siempre.
 *   2. el id local ya ES numérico → la fila vino de un pull sin ClientUuid
 *      (creada en la web), así que el id local es el del servidor
 *   3. hay mapeo en server_ids → la creó este teléfono y ya subió
 *   4. nada → el registro no se sincronizó todavía; el adjunto sigue esperando
 */
async function resolverServerId(
  coleccion: string,
  registroLocalId: string
): Promise<string | null> {
  // Genérico por _raw y no por un modelo tipado: esta cola sirve a cualquier
  // colección, y las que no tienen la columna simplemente devuelven undefined.
  try {
    const fila = await database.get(coleccion).find(registroLocalId);
    const delPull = (fila as unknown as { _raw: { server_id?: string | null } })._raw
      ?.server_id;
    if (delPull) return String(delPull);
  } catch {
    // El registro puede no existir ya (borrado local) o la colección no tener la
    // columna. Se sigue con los otros caminos.
  }

  if (/^\d+$/.test(registroLocalId)) return registroLocalId;

  // Se busca por las dos formas de case. SQL Server devuelve UNIQUEIDENTIFIER en
  // MAYÚSCULAS y el cliente genera minúsculas; la proyección ya normaliza a
  // minúsculas (v1.53/RC/51), pero un registro capturado ANTES de ese fix quedó con
  // el id en mayúsculas y su mapeo guardado en minúsculas. Sin esto, sus adjuntos
  // no subirían nunca.
  const fila = await database
    .get<ServerId>("server_ids")
    .query(
      Q.where("coleccion", coleccion),
      Q.or(
        Q.where("local_id", registroLocalId),
        Q.where("local_id", registroLocalId.toLowerCase())
      )
    )
    .fetch();

  return fila.length > 0 ? fila[0]!.serverId : null;
}

/**
 * Sube todos los adjuntos encolados que ya tengan a dónde ir.
 *
 * Recorre la cola completa, no sólo lo aceptado en este sync: es lo que hace que
 * funcione el caso normal (capturar el adjunto después de sincronizar el registro)
 * y que un upload fallido se reintente.
 */
export async function flushAdjuntos(): Promise<void> {
  const pendientes = await database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("status", Q.notEq("subida")))
    .fetch();
  if (pendientes.length === 0) return;

  const politicas = useSesion.getState().politicas;
  const http = getHttpClient();

  console.info(`[adjuntos] ${pendientes.length} en cola`);

  for (const adj of pendientes) {
    const entidad = entidadDe(politicas, adj.coleccion);
    const serverId = await resolverServerId(adj.coleccion, adj.registroLocalId);

    // Registro sin sincronizar, o entidad desconocida (manifest sin bajar): se
    // deja en la cola, sin marcarlo como error.
    //
    // Se LOGUEA el motivo: un salto silencioso acá ya nos costó una vez —la foto
    // no subía nunca y no había ni error ni rastro— y desde afuera es
    // indistinguible de "no había nada que subir".
    if (!entidad) {
      console.info(
        `[adjuntos] ${adj.coleccion} sin entidad conocida (¿manifest sin bajar?); queda en cola`
      );
      continue;
    }
    if (serverId == null) {
      console.info(
        `[adjuntos] ${adj.coleccion}/${adj.registroLocalId} todavía no tiene id de servidor; queda en cola`
      );
      continue;
    }

    const uri = adj.fileUri;
    const nombre = `${entidad.toLowerCase()}-${serverId}-${adj.id}.jpg`;

    try {
      await subir(http, entidad, serverId, uri, nombre);
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : String(err);
      // Se LOGUEA además de guardarse en la fila. El motivo queda en la pantalla de
      // adjuntos, pero para llegar ahí hay que sospechar primero — y en el log la
      // subida exitosa tampoco dice nada, así que un fallo era indistinguible de un
      // éxito para quien mira de afuera. Mismo criterio que el salto por entidad
      // desconocida, unas líneas más arriba.
      console.warn(
        `[adjuntos] falló subir ${adj.coleccion}/${adj.registroLocalId}: ${mensaje}`
      );
      await database.write(async () => {
        await adj.update((rec) => {
          rec.status = "error";
          rec.error = mensaje;
        });
      });
      continue;
    }

    // Subida OK. La fila NO se destruye ni se borra el archivo: la copia local se
    // conserva para poder verlo sin señal. La libera la purga, pasado el plazo.
    //
    // Desde acá nada puede "fallar el upload": ya está en el servidor y volver a
    // marcarlo como error lo haría subir dos veces.
    await database.write(async () => {
      await adj.update((rec) => {
        rec.status = "subida";
        rec.error = null;
        rec.subidaAt = Date.now();
      });
    });
    console.info(`[adjuntos] subida ${adj.coleccion}/${adj.registroLocalId} OK`);
  }
}

/**
 * Borra las copias LOCALES de adjuntos ya subidos que pasaron su plazo de
 * retención.
 *
 * Se conservan un tiempo para poder verlos sin señal; después se liberan (~190 KB
 * cada uno) y, si se vuelve a abrir el registro con conexión, se traen del
 * servidor. El adjunto en el ERP no se toca nunca: es parte del expediente.
 *
 * `dias` viene de la config del servidor (Mobile:RetencionFotosLocalesDias), no
 * hardcodeada, para poder ajustarla por instalación sin republicar el APK.
 */
export async function purgarAdjuntosLocales(dias: number): Promise<number> {
  if (!Number.isFinite(dias) || dias <= 0) return 0;

  const corte = Date.now() - dias * 24 * 60 * 60 * 1000;
  const viejos = await database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("status", "subida"), Q.where("subida_at", Q.lt(corte)))
    .fetch();
  if (viejos.length === 0) return 0;

  const uris = viejos.map((f) => f.fileUri);
  await database.write(async () => {
    for (const f of viejos) await f.destroyPermanently();
  });

  for (const uri of uris) {
    try {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    } catch {
      // Archivo ya borrado o inaccesible: la fila igual se fue, que es lo que importa.
    }
  }
  return viejos.length;
}

async function subir(
  http: ReturnType<typeof getHttpClient>,
  entidad: string,
  serverId: string,
  uri: string,
  nombre: string
): Promise<void> {
  const form = new FormData();
  // RN acepta este shape (uri/name/type) donde el DOM esperaría un Blob.
  form.append("file", { uri, name: nombre, type: "image/jpeg" } as unknown as Blob);
  form.append("notes", "Adjunto capturado desde la app promotor");

  await http.post(`/attachments/${entidad}/${serverId}`, form, {
    headers: {
      "Content-Type": "multipart/form-data",
      "X-Company-Id": String(contextoActual().companyId),
    },
  });
}
