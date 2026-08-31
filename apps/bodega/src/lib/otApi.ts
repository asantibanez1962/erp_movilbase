import { api } from "./api";
import { OtLocal, CambioOt } from "./otLocal";

/**
 * OT contra el servidor.
 *
 * La lectura va por el endpoint genérico contra OtMovilCA, que ya aplica el
 * alcance por empresa y por las bodegas del usuario, y que resuelve en la vista
 * la regla "sin fila de producción = Pendiente". Enviar es un endpoint propio:
 * es un proceso, no una consulta.
 */

const texto = (v: unknown) => String(v ?? "").trim();
const numero = (v: unknown) => Number(v ?? 0);

function campo(fila: Record<string, unknown>, ...nombres: string[]): unknown {
  for (const n of nombres) {
    if (fila[n] !== undefined) return fila[n];
    const alt = n.charAt(0).toLowerCase() + n.slice(1);
    if (fila[alt] !== undefined) return fila[alt];
  }
  return undefined;
}

/** "08:15:00" o "1970-01-01T08:15:00" → "08:15". Null si no hay. */
function hora(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  const m = /(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  return `${(m[1] ?? "").padStart(2, "0")}:${m[2] ?? "00"}`;
}

/** Las OT ABIERTAS de la bodega. La vista ya filtra tipodoc 5 y estado 0. */
export async function bajarOts(idBodega: number): Promise<OtLocal[]> {
  const { data } = await api.post("/data/OtMovilCA/filter", {
    filters: [{ field: "IdBodega", conditions: [{ operator: "=", value: idBodega }] }],
  });
  return ((data ?? []) as Record<string, unknown>[]).map((f) => ({
    id: numero(campo(f, "Id")),
    documento: texto(campo(f, "Documento")),
    fecha: texto(campo(f, "Fecha")).slice(0, 10),
    socio: texto(campo(f, "SocioNombre")),
    estado: numero(campo(f, "EstadoProduccion")),
    avance: numero(campo(f, "Avance")),
    horaInicio: hora(campo(f, "HoraInicio")),
    horaFin: hora(campo(f, "HoraFin")),
    notas: texto(campo(f, "Notas")),
    actualizadoAt: (campo(f, "ActualizadoAt") as string | null) ?? null,
  }));
}

export interface ResultadoEnviarOt {
  aplicados: number;
  conflictos: { id: number; estadoServidor?: number; avanceServidor?: number }[];
  rechazados: { id: number; motivo: string }[];
}

/**
 * Manda lo marcado sin señal.
 *
 * Cada cambio viaja con `baseAt`: el sello que tenía la OT cuando este teléfono
 * la bajó. Si en el servidor cambió desde entonces, otro operario la tocó y el
 * cambio vuelve en `conflictos` sin aplicarse. Sin eso, el último en enviar
 * pisaría al otro y el estado de la OT dependería de quién tuvo señal antes.
 */
export async function enviarOts(
  idBodega: number,
  cambios: Record<string, CambioOt>,
  ots: OtLocal[],
): Promise<ResultadoEnviarOt> {
  const selloPorId = new Map(ots.map((o) => [String(o.id), o.actualizadoAt]));
  const lista = Object.entries(cambios).map(([id, c]) => ({
    id: Number(id),
    estadoProduccion: c.estado,
    avance: c.avance,
    horaInicio: c.horaInicio,
    horaFin: c.horaFin,
    notas: c.notas,
    baseAt: selloPorId.get(id) ?? null,
  }));
  const { data } = await api.post("/api/ca/movil/ot/enviar", { idBodega, cambios: lista });
  return data as ResultadoEnviarOt;
}
