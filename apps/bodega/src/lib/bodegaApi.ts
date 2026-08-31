import { api } from "./api";

/**
 * Las llamadas de la app.
 *
 * SALVO EL MOVIMIENTO, TODAS USAN LOS ENDPOINTS GENERICOS DEL PLATFORM —los
 * mismos que usa el web—. No hay endpoints propios de consulta a propósito:
 * /data/{entity}/filter ya aplica permisos, alcance por compañía, alcance por
 * las bodegas del usuario y los filtros fijos de la EntityView. Escribir una
 * consulta propia significaría reimplementar todo eso y que el día que cambie
 * una regla, el móvil y el web se separen sin que nadie lo note.
 */

export interface Empresa {
  id: number;
  nombre: string;
}

export interface Bodega {
  id: number;
  nombre: string;
}

export interface Ubicacion {
  id: number;
  nombre: string;
}

export interface Partida {
  /** IdDetalleMovimiento — es lo que se manda al mover. */
  id: number;
  partida: string;
  sacos: number;
  peso: number;
  idUbicacion: number;
  ubicacion: string;
  calidad: string;
}

const texto = (v: unknown) => String(v ?? "").trim();
const numero = (v: unknown) => Number(v ?? 0);

/** Lee un campo sin depender de si el backend lo devuelve en Pascal o camel. */
function campo(fila: Record<string, unknown>, ...nombres: string[]): unknown {
  for (const n of nombres) {
    if (fila[n] !== undefined) return fila[n];
    const alt = n.charAt(0).toLowerCase() + n.slice(1);
    if (fila[alt] !== undefined) return fila[alt];
  }
  return undefined;
}

/**
 * Las empresas del usuario.
 *
 * Va por /api/mobile/contexto y NO por el token: `UserSummary` del store de
 * auth trae solo id y usuario. La empresa sale de los claims del JWT del lado
 * del servidor, que es el unico que sabe si el usuario es admin —y ve todas—
 * o tiene un claim `company[]` acotado.
 *
 * Es la primera llamada de la app y la unica que NO manda X-Company-Id:
 * justamente es la que dice cual mandar.
 */
export async function cargarEmpresas(): Promise<Empresa[]> {
  const { data } = await api.get("/api/mobile/contexto");
  const filas = ((data as { companias?: unknown[] } | null)?.companias ?? []) as Record<string, unknown>[];
  return filas.map((f) => ({
    id: numero(campo(f, "Id")),
    nombre: texto(campo(f, "Nombre")),
  }));
}

export async function cargarBodegas(): Promise<Bodega[]> {
  const { data } = await api.get("/lookup/BodegaCA");
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: numero(campo(f, "Id", "id")),
    nombre: texto(campo(f, "Nombre", "label", "nombre")),
  }));
}

export async function cargarUbicaciones(idBodega: number): Promise<Ubicacion[]> {
  const { data } = await api.post("/data/UbicacionCA/filter", {
    filters: [
      { field: "IdBodega", conditions: [{ operator: "=", value: idBodega }] },
      // Sólo las de documento: en las de granel (silos) el café no se maneja
      // por partida sino por FIFO, y un cambio de ubicación no aplica.
      { field: "PorDocumento", conditions: [{ operator: "=", value: true }] },
    ],
  });
  return (data ?? [])
    .map((f: Record<string, unknown>) => ({
      id: numero(campo(f, "Id")),
      nombre: texto(campo(f, "Nombre")),
    }))
    .sort((a: Ubicacion, b: Ubicacion) => a.nombre.localeCompare(b.nombre));
}

/**
 * Las partidas con saldo. Los dos filtros del legacy: por ubicación —el
 * operario está parado frente a una fila— o por número de partida, cuando sabe
 * cuál busca pero no dónde está. Cualquiera de los dos, o ninguno.
 */
export async function cargarPartidas(opts: {
  idBodega: number;
  idUbicacion?: number | null;
  partida?: string | null;
}): Promise<Partida[]> {
  const filters: unknown[] = [
    { field: "IdBodega", conditions: [{ operator: "=", value: opts.idBodega }] },
  ];
  if (opts.idUbicacion) {
    filters.push({ field: "IdUbicacion", conditions: [{ operator: "=", value: opts.idUbicacion }] });
  }
  const busca = (opts.partida ?? "").trim();
  if (busca) {
    // "contiene" y no "empieza con": el operario lee "001746-01" de la etiqueta
    // y teclea "1746".
    filters.push({ field: "Partida", conditions: [{ operator: "contains", value: busca }] });
  }

  const { data } = await api.post("/data/PartidaSaldoCA/filter", { filters });
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: numero(campo(f, "Id")),
    partida: texto(campo(f, "Partida")),
    sacos: numero(campo(f, "ExistenciaSacos")),
    peso: numero(campo(f, "ExistenciaPeso")),
    idUbicacion: numero(campo(f, "IdUbicacion")),
    ubicacion: "",   // lo completa la pantalla con el catálogo que ya tiene
    calidad: texto(campo(f, "Calidad")),
  }));
}

export interface ResultadoMovimiento {
  idMovimiento: number;
  documento: string;
  partida: string;
  sacos: number;
  pesoNeto: number;
  repetido: boolean;
}

/**
 * El movimiento. Único endpoint propio: el servidor arma el documento entero
 * —encabezado, salida, resultado, sacos y trazabilidad— desde estos tres datos.
 *
 * El uuid lo genera la app por cada intento y hace la llamada idempotente: si
 * la respuesta se pierde y el operario vuelve a tocar el botón, el servidor
 * devuelve el documento que ya creó en vez de mover el café dos veces.
 */
export async function moverPartida(p: {
  idOrigenDetalle: number;
  idUbicacionDestino: number;
  clientUuid: string;
}): Promise<ResultadoMovimiento> {
  const { data } = await api.post("/api/ca/movil/cambio-ubicacion", p);
  return data as ResultadoMovimiento;
}

/** Los cambios de ubicación de hoy, para revisar el turno. */
export async function cargarMovimientosHoy(idBodega: number) {
  const hoy = new Date();
  const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).toISOString();
  const { data } = await api.post("/data/MovimientoCambioUbicacionCA/filter", {
    filters: [
      { field: "IdBodega", conditions: [{ operator: "=", value: idBodega }] },
      { field: "Fecha", conditions: [{ operator: ">=", value: desde }] },
    ],
  });
  return (data ?? []).map((f: Record<string, unknown>) => ({
    id: numero(campo(f, "Id")),
    documento: texto(campo(f, "Documento")),
    sacos: numero(campo(f, "Sacos")),
    pesoNeto: numero(campo(f, "PesoNeto")),
  }));
}
