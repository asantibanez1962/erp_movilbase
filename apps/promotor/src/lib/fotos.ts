import { Q } from "@nozbe/watermelondb";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import type { PushResponse } from "@erp/shared-types";
import { database } from "./db";
import { getHttpClient } from "./api";
import { config } from "./config";
import { PendingUpload } from "../db/models";

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
 * filesystem al tomarla y se sube después del sync, cuando ya tenemos el id.
 *
 * La cola vive en `pending_uploads`, una tabla WMDB local que no está en ninguna
 * colección de sync — nunca se pushea.
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

export async function fotosPendientesDe(
  visitaLocalId: string
): Promise<PendingUpload[]> {
  return database
    .get<PendingUpload>("pending_uploads")
    .query(Q.where("visita_local_id", visitaLocalId))
    .fetch();
}

/**
 * Sube las fotos de las visitas que el push acaba de aceptar.
 *
 * `pushResponses` viene de runSync: sus `accepted[]` son la ÚNICA fuente del
 * localId → serverId. No lo sacamos de la fila local a propósito — escribir el
 * server id en una fila ya sincronizada la marcaría como 'updated' y WMDB la
 * re-pushearía (ver syncEngine).
 *
 * Las visitas sincronizadas en corridas anteriores cuyas fotos fallaron quedan
 * encoladas hasta que su visita vuelva a aparecer en un accepted[]. Es una
 * limitación real y está anotada en el design doc.
 */
export async function flushPendingUploads(
  pushResponses?: Record<string, PushResponse>
): Promise<void> {
  const aceptadas = pushResponses?.["visitas"]?.accepted?.["visitas"] ?? [];
  if (aceptadas.length === 0) return;

  const http = getHttpClient();

  for (const fila of aceptadas) {
    const pendientes = await fotosPendientesDe(fila.local_id);
    for (const foto of pendientes) {
      try {
        await subirFoto(http, fila.server_id, foto);
        // Subida OK → la fila de la cola y el archivo local ya no hacen falta.
        await database.write(async () => {
          await foto.destroyPermanently();
        });
        await FileSystem.deleteAsync(foto.fileUri, { idempotent: true });
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        await database.write(async () => {
          await foto.update((rec) => {
            rec.status = "error";
            rec.error = mensaje;
          });
        });
      }
    }
  }
}

async function subirFoto(
  http: ReturnType<typeof getHttpClient>,
  serverId: string,
  foto: PendingUpload
): Promise<void> {
  const form = new FormData();
  // RN acepta este shape (uri/name/type) donde el DOM esperaría un Blob.
  form.append("file", {
    uri: foto.fileUri,
    name: `visita-${serverId}-${foto.id}.jpg`,
    type: "image/jpeg",
  } as unknown as Blob);
  form.append("notes", "Foto de visita de campo (app promotor)");

  await http.post(`/attachments/Visita/${serverId}`, form, {
    headers: {
      "Content-Type": "multipart/form-data",
      "X-Company-Id": String(config.companyId),
    },
  });
}
