import { api } from "./api";
import { FilaToma } from "./tomaLocal";

/**
 * Toma física contra el servidor.
 *
 * La LECTURA va por el endpoint genérico de la plataforma contra
 * TomaFisicaMovilCA, igual que el resto de la app: esa entidad ya aplica el
 * alcance por empresa y por las bodegas del usuario, y —esto es lo importante—
 * NO expone los sacos ni el peso que el sistema espera. El conteo es a ciegas.
 *
 * Crear y enviar son endpoints propios: son procesos, no consultas.
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

export interface ResumenToma {
  fecha: string;
  idBodega: number;
  total: number;
  contadas: number;
  pendientes: number;
}

/** Cuántas partidas tiene la toma de esa fecha y cuántas van contadas. */
export async function resumenToma(idBodega: number, fecha: string): Promise<ResumenToma> {
  const { data } = await api.get("/api/ca/movil/toma-fisica/resumen", {
    params: { idBodega, fecha },
  });
  return data as ResumenToma;
}

export interface ResultadoCrear {
  fecha: string;
  idBodega: number;
  creadas: number;
  reemplazadas: number;
}

/**
 * Crea la toma del día. CONECTADO: es el servidor el que decide qué partidas
 * entran, con la foto de saldos del momento.
 */
export async function crearToma(idBodega: number, fecha: string): Promise<ResultadoCrear> {
  const { data } = await api.post("/api/ca/movil/toma-fisica/crear", { idBodega, fecha });
  return data as ResultadoCrear;
}

/**
 * Baja las filas de la toma. Convierte campo por campo y NO con un spread: si
 * algún día alguien agrega sacos o peso a la vista, tienen que quedar afuera
 * del teléfono igual.
 */
export async function bajarToma(idBodega: number, fecha: string): Promise<FilaToma[]> {
  const { data } = await api.post("/data/TomaFisicaMovilCA/filter", {
    filters: [
      { field: "IdBodega", conditions: [{ operator: "=", value: idBodega }] },
      { field: "Fecha", conditions: [{ operator: "=", value: fecha }] },
    ],
  });
  return ((data ?? []) as Record<string, unknown>[]).map((f) => {
    const contado = campo(f, "Existencia");
    return {
      id: numero(campo(f, "Id")),
      partida: texto(campo(f, "Partida")),
      idUbicacion: numero(campo(f, "IdUbicacion")),
      ubicacion: texto(campo(f, "UbicacionNombre")),
      calidad: texto(campo(f, "Calidad")),
      contadoServidor: contado === null || contado === undefined ? null : Number(contado),
    };
  });
}

export interface ResultadoEnviar {
  aplicados: number;
  conflictos: { id: number; contadoPor?: number; motivo?: string }[];
  noEncontrados: number[];
  pendientes: number;
}

/**
 * Manda en un lote lo digitado sin señal.
 *
 * El servidor no pisa el conteo de otro operario: lo que rechaza vuelve en
 * `conflictos`. En una bodega hay varios contando, y sobrescribir en silencio
 * haría que el inventario dependiera de quién apretó "enviar" último.
 */
export async function enviarToma(
  idBodega: number,
  fecha: string,
  conteos: Record<string, number | null>,
): Promise<ResultadoEnviar> {
  const lista = Object.entries(conteos).map(([id, existencia]) => ({
    id: Number(id),
    existencia,
  }));
  const { data } = await api.post("/api/ca/movil/toma-fisica/enviar", {
    idBodega,
    fecha,
    conteos: lista,
  });
  return data as ResultadoEnviar;
}

export interface Opciones {
  cambioUbicacion: { ver: boolean; mover: boolean };
  tomaFisica: { ver: boolean; crear: boolean; contar: boolean };
  ot: { ver: boolean; registrar: boolean };
}

/**
 * Qué puede hacer este usuario. El menú se arma con esto en vez de mostrar
 * todo y dejar que las opciones fallen con 403 al tocarlas.
 *
 * Si la llamada falla —servidor viejo, sin señal— se asume que NO puede nada y
 * el menú queda con lo que no necesita permiso. Es lo contrario de lo cómodo,
 * y es lo correcto: un permiso que no se pudo verificar no es un permiso.
 */
export async function cargarOpciones(): Promise<Opciones> {
  const { data } = await api.get("/api/ca/movil/opciones");
  return data as Opciones;
}

export const OPCIONES_CERRADAS: Opciones = {
  cambioUbicacion: { ver: false, mover: false },
  tomaFisica: { ver: false, crear: false, contar: false },
  ot: { ver: false, registrar: false },
};
