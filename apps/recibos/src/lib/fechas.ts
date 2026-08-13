/**
 * Fechas y horas LOCALES para el servidor.
 *
 * ⚠️ EL PROBLEMA QUE ESTO RESUELVE, Y POR QUÉ ES CARO. El teléfono guarda instantes en
 * milisegundos, que es lo cómodo para ordenar y mostrar. Pero varias columnas del
 * servidor no son instantes:
 *
 *     re_Bitacora_recibos.fecha   date        recibos.fecha    date
 *     re_Bitacora_recibos.hora_*  time        recibos.agregado datetime
 *     remedida.fecha              date
 *
 * El BE convierte los milisegundos que le llegan con `DateTimeOffset.FromUnixTimeMilli-
 * seconds(...).UtcDateTime`, o sea EN UTC. Costa Rica está en UTC−6, así que una jornada
 * abierta a las 20:13 del 13 de agosto se guardaba como **14 de agosto**. En una columna
 * `date` eso ya no se distingue de un dato bueno: el documento queda archivado en el día
 * equivocado y nadie tiene cómo saberlo.
 *
 * Y las columnas `time` directamente reventaban: el modelo las declara `TimeSpan?`, la
 * conversión del BE sólo cubre `DateTime`, y el número llegaba crudo a EF. Ése fue el
 * SERVER_ERROR que rechazaba toda bitácora.
 *
 * La salida es no mandar un instante donde el modelo espera una fecha y una hora locales.
 * Un texto `2026-08-13` o `20:13:00` no tiene zona horaria que interpretar mal.
 */

const dos = (n: number) => String(n).padStart(2, "0");

/** `2026-08-13` en hora LOCAL del teléfono. */
export function comoFechaLocal(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** `20:13:00` en hora LOCAL del teléfono. */
export function comoHoraLocal(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  const d = new Date(ms);
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
}

/** `2026-08-13 20:13:00` — para las columnas `datetime`, que sí llevan hora. */
export function comoFechaHoraLocal(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  return `${comoFechaLocal(ms)} ${comoHoraLocal(ms)}`;
}

/**
 * Qué campo de cada colección es fecha, hora o fecha-hora.
 *
 * Se declara acá y no se adivina por el nombre: `fecha` es una fecha en las tres tablas,
 * pero `agregado` es fecha-hora y `hora_inicio` es sólo hora. Adivinar por el nombre
 * funcionaría hasta la primera columna que se llame distinto.
 */
const CAMPOS: Record<string, Record<string, "fecha" | "hora" | "fechahora">> = {
  bitacoras: { fecha: "fecha", hora_inicio: "hora", hora_final: "hora" },
  recibos: { fecha: "fecha", agregado: "fechahora" },
  remedidas: { fecha: "fecha" },
};

/**
 * Convierte los instantes de una fila a lo que espera su columna.
 *
 * Se le pasa a `runSync` como `prepararEnvio`: es una regla del transporte, no del
 * dominio. Las pantallas siguen trabajando con timestamps.
 */
export function prepararFechas(
  coleccion: string,
  fila: Record<string, unknown>
): Record<string, unknown> {
  const mapa = CAMPOS[coleccion];
  if (!mapa) return fila;

  const salida = { ...fila };
  for (const [campo, clase] of Object.entries(mapa)) {
    const valor = salida[campo];
    if (typeof valor !== "number") continue;
    if (clase === "fecha") salida[campo] = comoFechaLocal(valor);
    else if (clase === "hora") salida[campo] = comoHoraLocal(valor);
    else salida[campo] = comoFechaHoraLocal(valor);
  }
  return salida;
}
