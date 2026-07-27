import { database } from "./db";
import { getHttpClient } from "./api";
import { contextoActual } from "./sesion";
import { registrarEvento } from "./bitacora";
import { Solicitud } from "../db/models";

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
 * DÓNDE QUEDA EL RESULTADO: en la fila local, siempre, y viaja al servidor con el
 * próximo push — igual que cualquier otro dato que el teléfono captura. Un solo camino,
 * sin importar si la solicitud ya estaba sincronizada.
 *
 * Eso es posible porque el push acepta `updated` y manda sólo los campos que cambiaron:
 * estos dos y nada más. Antes no se podía, y el BE tenía que escribirlos él en la misma
 * request — dos escritores del mismo dato.
 *
 * La consulta requiere internet, pero NO requiere haber sincronizado antes: son
 * independientes.
 */

export interface ResultadoAtv {
  resultadoAtv: number;
  consultadoAtv: number;
  mensaje: string;
}

interface RespuestaAtv {
  resultadoatv?: number;
  consultadoatv?: number;
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

  try {
    const http = getHttpClient();
    const resp = await http.post<RespuestaAtv>(
      "/api/mobile/hacienda/atv",
      // Sólo el productor: la consulta es un LOOKUP, no una escritura.
      //
      // El endpoint sabe persistir el veredicto si se le manda la solicitud (por id o
      // por uuid), y a propósito no se le manda: el veredicto viaja en el push como
      // cualquier otro cambio del teléfono. Si se hicieran las dos cosas habría dos
      // escritores del mismo dato, y el segundo —el push— llegaría con la versión que
      // el propio móvil acaba de dejar obsoleta.
      { idSocio: solicitud.idSocio },
      { headers: { "X-Company-Id": String(contextoActual().companyId) } }
    );

    const resultadoAtv = resp.data?.resultadoatv ?? 0;
    const consultadoAtv = resp.data?.consultadoatv ?? Date.now();
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
        resultadoAtv,
      },
      duracionMs: Date.now() - inicio,
    });

    return { resultadoAtv, consultadoAtv, mensaje };
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
 * Guarda el veredicto en la fila local, haya subido o no.
 *
 * Si ya estaba sincronizada, WatermelonDB la marca 'updated' y el push la manda con
 * SÓLO estos dos campos (`_changed`), que están en el conjunto actualizable de la
 * colección. Antes esto no se podía —el push rechazaba `updated` y la fila quedaba
 * pendiente para siempre— y por eso el BE escribía el veredicto él mismo. Ahora el
 * camino es uno solo, igual que para cualquier otro dato que el teléfono captura.
 */
async function guardarVeredicto(
  solicitud: Solicitud,
  resultadoAtv: number,
  consultadoAtv: number
): Promise<void> {
  await database.write(async () => {
    await solicitud.update((rec) => {
      rec.resultadoAtv = resultadoAtv;
      rec.consultadoAtv = consultadoAtv;
    });
  });
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
