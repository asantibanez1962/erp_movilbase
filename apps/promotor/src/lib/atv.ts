import { database } from "./db";
import { getHttpClient } from "./api";
import { contextoActual } from "./sesion";
import { registrarEvento } from "./bitacora";
import { ServerId, Solicitud } from "../db/models";
import { Q } from "@nozbe/watermelondb";

/**
 * Consulta ATV (Hacienda CR) del productor de una solicitud.
 *
 * Requiere internet: es una llamada al Ministerio a través del BE. En el campo casi
 * nunca hay, así que la consulta es un acto explícito del promotor cuando ve que
 * tiene señal — nunca automática, y nunca bloqueante para levantar la solicitud.
 *
 * Los dos campos que escribe (`resultado_atv`, `consultado_atv`) NO son de captura:
 * ningún form los toca. Sólo se mueven por acá.
 *
 * DÓNDE QUEDA EL RESULTADO, que depende de si la solicitud ya subió:
 *
 *   - solicitud local  → se guarda en la fila local y viaja con el próximo push.
 *     Es el caso normal: se consulta antes de sincronizar.
 *   - solicitud ya sincronizada → el push NO puede llevarlo (sólo sube filas nuevas,
 *     no modifica las que ya subieron). Por eso se le manda al BE el id de servidor
 *     y él la escribe directo. El teléfono igual guarda su copia para mostrarla.
 *
 * En los dos casos el promotor ve el veredicto en pantalla y no tiene que saber en
 * cuál está.
 */

export interface ResultadoAtv {
  resultadoAtv: number;
  consultadoAtv: number;
  /** true = el veredicto ya quedó en el servidor; false = viaja con el próximo push. */
  persistido: boolean;
  mensaje: string;
}

interface RespuestaAtv {
  resultadoatv?: number;
  consultadoatv?: number;
  persistido?: boolean;
  message?: string;
}

export async function consultarAtv(solicitud: Solicitud): Promise<ResultadoAtv> {
  if (solicitud.idSocio == null) {
    throw new Error("La solicitud no tiene productor, así que no hay cédula que consultar.");
  }
  if (!solicitud.estaPendiente) {
    throw new Error(
      "La solicitud ya fue aprobada o rechazada; Hacienda sólo se consulta mientras está pendiente."
    );
  }

  const inicio = Date.now();
  const solicitudId = await idDeServidor(solicitud);

  try {
    const http = getHttpClient();
    const resp = await http.post<RespuestaAtv>(
      "/api/mobile/hacienda/atv",
      {
        idSocio: solicitud.idSocio,
        solicitudId,
        // El uuid va SIEMPRE, incluso con solicitudId resuelto. Es el que permite al BE
        // encontrar la fila cuando el teléfono no conoce el id numérico — o sea, en
        // cualquier solicitud de un cache existente, porque `server_id` sólo llega en las
        // filas que bajan en un delta. Sin esto la consulta se perdía en silencio.
        clientUuid: solicitud.clientUuid,
      },
      { headers: { "X-Company-Id": String(contextoActual().companyId) } }
    );

    const resultadoAtv = resp.data?.resultadoatv ?? 0;
    const consultadoAtv = resp.data?.consultadoatv ?? Date.now();
    const persistido = resp.data?.persistido === true;
    const mensaje = resp.data?.message ?? "Consulta realizada.";

    await guardarVeredicto(solicitud, resultadoAtv, consultadoAtv);

    await registrarEvento({
      tipo: "atv",
      // resultado 0 = se consultó y no hubo respuesta útil. La llamada funcionó,
      // pero para el promotor no sirvió: se marca como no-ok para que se vea en la
      // bitácora sin tener que abrir el detalle.
      ok: resultadoAtv !== 0,
      resumen: `ATV socio ${solicitud.idSocio}: ${mensaje}`,
      detalle: {
        idSocio: solicitud.idSocio,
        solicitudLocal: solicitud.id,
        solicitudServidor: solicitudId,
        resultadoAtv,
        persistido,
      },
      duracionMs: Date.now() - inicio,
    });

    return { resultadoAtv, consultadoAtv, persistido, mensaje };
  } catch (err) {
    const mensaje = mensajeDeError(err);
    await registrarEvento({
      tipo: "atv",
      ok: false,
      resumen: `ATV socio ${solicitud.idSocio}: falló`,
      detalle: { idSocio: solicitud.idSocio, solicitudLocal: solicitud.id },
      error: mensaje,
      duracionMs: Date.now() - inicio,
    });
    throw new Error(mensaje);
  }
}

/**
 * Guarda el veredicto en la fila local — SÓLO si la solicitud todavía no subió.
 *
 * Por qué no se guarda en una ya sincronizada: cualquier escritura la marca
 * 'updated', y el push del BE no acepta `updated` (la rechaza con NOT_SUPPORTED).
 * La fila quedaría contada como pendiente para siempre, sin nada que el promotor
 * pueda hacer al respecto — y encima sin necesidad, porque en ese caso el veredicto
 * ya lo escribió el BE en la misma request y baja solo en el próximo pull (la
 * proyección incluye las dos columnas desde v1.53/RC/52).
 *
 * O sea: local → se guarda acá y viaja con el push; sincronizada → la fuente es el
 * servidor. Mientras tanto la pantalla muestra el veredicto que devolvió la llamada.
 */
async function guardarVeredicto(
  solicitud: Solicitud,
  resultadoAtv: number,
  consultadoAtv: number
): Promise<void> {
  if (!solicitud.esLocal) return;

  await database.write(async () => {
    await solicitud.update((rec) => {
      rec.resultadoAtv = resultadoAtv;
      rec.consultadoAtv = consultadoAtv;
    });
  });
}

/**
 * Id de servidor de la solicitud, o null si todavía no subió.
 *
 * Tres caminos, en orden de confiabilidad:
 *   1. `server_id` de la fila → lo manda el pull (v1.53/RC/54). Es el único que cubre
 *      el caso de una fila bajada del servidor que ESTE teléfono nunca pusheó — que en
 *      un dispositivo nuevo son todas. Su ausencia hacía que la consulta ATV se
 *      perdiera: no se guardaba local (la fila no es local) ni en el servidor (se
 *      mandaba solicitudId=null).
 *   2. el id local es numérico → la fila vino de un pull sin ClientUuid (creada en la
 *      web), así que su id local ES el del servidor
 *   3. mapeo en server_ids → la creó este teléfono y ya subió
 */
async function idDeServidor(solicitud: Solicitud): Promise<number | null> {
  const delPull = Number(solicitud.serverIdRemoto);
  if (Number.isFinite(delPull) && delPull > 0) return delPull;

  if (/^\d+$/.test(solicitud.id)) return Number(solicitud.id);

  const filas = await database
    .get<ServerId>("server_ids")
    .query(
      Q.where("coleccion", "solicitudes"),
      // Las dos formas de case, por los registros capturados antes de v1.53/RC/51.
      Q.or(
        Q.where("local_id", solicitud.id),
        Q.where("local_id", solicitud.id.toLowerCase())
      )
    )
    .fetch();

  const serverId = filas.length > 0 ? Number(filas[0]!.serverId) : NaN;
  return Number.isFinite(serverId) ? serverId : null;
}

/**
 * Mensaje útil para el promotor. El BE devuelve códigos concretos (SIN_CEDULA,
 * NO_PENDIENTE) que dicen exactamente qué hacer; sin esto todo terminaría como
 * "Error de conexión", que manda a buscar señal cuando el problema es que al
 * productor le falta la cédula en el ERP.
 */
function mensajeDeError(err: unknown): string {
  const respuesta = (err as { response?: { data?: { message?: string; code?: string } } })
    ?.response;
  if (respuesta?.data?.message) return respuesta.data.message;
  const mensaje = (err as Error)?.message;
  if (mensaje?.includes("Network")) {
    return "Sin conexión: la consulta a Hacienda necesita internet. Probá donde haya señal.";
  }
  return mensaje ?? "No se pudo consultar Hacienda.";
}
