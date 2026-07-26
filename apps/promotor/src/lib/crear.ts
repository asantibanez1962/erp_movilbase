import type { Model } from "@nozbe/watermelondb";
import { database } from "./db";
import { config } from "./config";
import { randomUUID } from "./deviceId";
import { Entregador, Solicitud, Visita } from "../db/models";

/**
 * Creación de las filas que el teléfono origina (solicitudes, entregadores,
 * visitas).
 *
 * Por qué no se llama `collection.create()` directo: las tres colecciones son
 * bidireccionales, así que la fila que sube va a volver a bajar en el próximo
 * pull. Para que WMDB la reconozca en vez de duplicarla, el id local tiene que
 * ser el mismo valor que el servidor devuelve como `id` — y el servidor devuelve
 * el ClientUuid cuando existe.
 *
 * Eso obliga a dos cosas que estos helpers centralizan:
 *   1. el id local es un UUID v4 nuestro, no el id que genera WMDB (que no tiene
 *      formato GUID y no entra en una columna UNIQUEIDENTIFIER)
 *   2. ese mismo uuid viaja en client_uuid
 *
 * Si alguna pantalla crea una de estas filas sin pasar por acá, el síntoma no
 * aparece al guardar ni al sincronizar: aparece en el SEGUNDO sync, como una
 * fila duplicada. De ahí que valga la pena el helper.
 */

async function crearConUuid<T extends Model>(
  tabla: string,
  aplicar: (rec: T, uuid: string) => void
): Promise<T> {
  const uuid = randomUUID();
  return database.write(async () =>
    database.get<T>(tabla).create((rec) => {
      // WMDB permite fijar el id sólo en el momento de la creación.
      (rec as unknown as { _raw: { id: string } })._raw.id = uuid;
      aplicar(rec, uuid);
    })
  );
}

export interface NuevaSolicitudInput {
  idSocio: number;
  codigo?: string | null;
  cosecha?: string | null;
  zona?: string | null;
  fecha?: Date;
  efectivo?: number;
  insumos?: number;
  almacigo?: number;
  formalizacion?: number;
  otros?: number;
  planInversion?: string | null;
  motivo?: string | null;
  entregaEstimada?: number | null;
  prodEstimada?: number | null;
}

export async function crearSolicitud(
  input: NuevaSolicitudInput
): Promise<Solicitud> {
  const rubros =
    (input.efectivo ?? 0) +
    (input.insumos ?? 0) +
    (input.almacigo ?? 0) +
    (input.formalizacion ?? 0) +
    (input.otros ?? 0);

  return crearConUuid<Solicitud>("solicitudes", (rec, uuid) => {
    rec.clientUuid = uuid;
    rec.idSocio = input.idSocio;
    rec.codigo = input.codigo ?? null;
    rec.cosecha = input.cosecha ?? null;
    rec.zona = input.zona ?? null;
    rec.fecha = (input.fecha ?? new Date()).getTime();
    rec.efectivo = input.efectivo ?? null;
    rec.insumos = input.insumos ?? null;
    rec.almacigo = input.almacigo ?? null;
    rec.formalizacion = input.formalizacion ?? null;
    rec.otros = input.otros ?? null;
    rec.total = rubros;
    rec.planInversion = input.planInversion ?? null;
    rec.motivo = input.motivo ?? null;
    rec.entregaEstimada = input.entregaEstimada ?? null;
    rec.prodEstimada = input.prodEstimada ?? null;
    rec.estado = 0; // pendiente de aprobación — la web la resuelve
    rec.compania = config.companyId;
    rec.pushStatus = null;
    rec.pushError = null;
  });
}

/**
 * `idSolicitudLocal` es el id LOCAL del padre, sin importar si nació acá o vino
 * de un pull. El BE distingue: numérico → id del servidor; uuid → lo resuelve
 * contra mt.MobileIdMap.
 *
 * Se mandan idSocio Y codigo: la relación real es idSocio, y el código va
 * denormalizado porque el legacy PB vincula por ahí. Los dos salen del mismo
 * productor elegido, así que no pueden quedar inconsistentes.
 */
export async function crearEntregador(
  idSolicitudLocal: string,
  idSocio: number,
  codigo: string
): Promise<Entregador> {
  return crearConUuid<Entregador>("entregadores", (rec, uuid) => {
    rec.clientUuid = uuid;
    rec.idSolicitud = idSolicitudLocal;
    rec.idSocio = idSocio;
    rec.codigo = codigo;
    rec.pushStatus = null;
    rec.pushError = null;
  });
}

export interface NuevaVisitaInput {
  idTipoVisita: number;
  idSocio: number;
  cosecha?: string | null;
  idFinca?: number | null;
  /** Id local de la solicitud — sólo para tipos con requiere_solicitud. */
  idSolicitudLocal?: string | null;
  observaciones?: string | null;
  prodEstimadaPromotor?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  fecha?: Date;
}

export async function crearVisita(input: NuevaVisitaInput): Promise<Visita> {
  return crearConUuid<Visita>("visitas", (rec, uuid) => {
    rec.clientUuid = uuid;
    rec.idTipoVisita = input.idTipoVisita;
    rec.idSocio = input.idSocio;
    rec.cosecha = input.cosecha ?? null;
    rec.idFinca = input.idFinca ?? null;
    rec.idSolicitud = input.idSolicitudLocal ?? null;
    rec.observaciones = input.observaciones ?? null;
    rec.prodEstimadaPromotor = input.prodEstimadaPromotor ?? null;
    rec.gpsLat = input.gpsLat ?? null;
    rec.gpsLng = input.gpsLng ?? null;
    rec.fecha = (input.fecha ?? new Date()).getTime();
    rec.estado = 0;
    rec.compania = config.companyId;
    rec.pushStatus = null;
    rec.pushError = null;
  });
}
