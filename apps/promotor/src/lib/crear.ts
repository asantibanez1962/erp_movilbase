import type { Model } from "@nozbe/watermelondb";
import { database } from "./db";
import { useSesion } from "./sesion";
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

/**
 * Empresa y cosecha de la sesión. Se leen acá y no de config para que lo que se
 * crea quede en la misma empresa/cosecha que el promotor está viendo — el BE
 * igual pisa `compania` con el header, pero la fila local tiene que coincidir o
 * la lista filtrada no la muestra después de guardarla.
 */
function sesion(): { companyId: number; cosecha: string | null } {
  const s = useSesion.getState();
  if (s.companyId == null) {
    throw new Error("No hay empresa seleccionada en la sesión.");
  }
  return { companyId: s.companyId, cosecha: s.cosecha };
}

async function crearConUuid<T extends Model>(
  tabla: string,
  aplicar: (rec: T, uuid: string) => void
): Promise<T> {
  // MINÚSCULAS, siempre. Es la forma canónica del texto UUID y la que devuelve la
  // proyección del pull (v1.53/RC/51). SQL Server renderiza UNIQUEIDENTIFIER en
  // MAYÚSCULAS, y como los ids de WatermelonDB son case-sensitive, una diferencia
  // de case hace que la fila que vuelve del servidor se vea como OTRA y se duplique.
  const uuid = randomUUID().toLowerCase();
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
  // cosecha NO va acá: sale de la sesión (ver sesion()).
  /** Zona del productor. Se hereda del productor elegido, no se pide. */
  zona?: string | null;
  fecha?: Date;
  /** rc_tipodesembolso.idtipodesembolso. La variante vigente es tipo + total. */
  tipoCredito: number;
  total: number;
  planInversion?: string | null;
  motivo?: string | null;
  entregaEstimada?: number | null;
  prodEstimada?: number | null;
}

export async function crearSolicitud(
  input: NuevaSolicitudInput
): Promise<Solicitud> {
  const { companyId, cosecha } = sesion();

  return crearConUuid<Solicitud>("solicitudes", (rec, uuid) => {
    rec.clientUuid = uuid;
    rec.idSocio = input.idSocio;
    rec.codigo = input.codigo ?? null;
    // La cosecha viene de la sesión, no de un campo tipeado: los códigos válidos
    // son los de rc_cosechas ("2026-2027") y a mano se escriben mal.
    rec.cosecha = cosecha;
    // Heredada del productor: el promotor no la elige.
    rec.zona = input.zona ?? null;
    rec.fecha = (input.fecha ?? new Date()).getTime();
    rec.tipoCredito = input.tipoCredito;
    rec.total = input.total;
    // Los rubros quedan en null: el móvil usa la variante tipo + total. Las
    // solicitudes históricas que sí los tienen se siguen bajando y mostrando.
    rec.planInversion = input.planInversion ?? null;
    rec.motivo = input.motivo ?? null;
    rec.entregaEstimada = input.entregaEstimada ?? null;
    rec.prodEstimada = input.prodEstimada ?? null;
    rec.estado = 0; // pendiente de aprobación — la web la resuelve
    rec.compania = companyId;
    rec.pushStatus = null;
    rec.pushError = null;
  });
}

/**
 * Edita una solicitud, haya subido o no.
 *
 * La regla ya no es "sólo mientras es local" sino **mientras la oficina no la
 * resolvió**: `estado` en 0. Es la política `hasta-resolucion` de la colección, y por
 * eso el guard mira el estado y no `_status`.
 *
 * Si la fila ya estaba sincronizada, WatermelonDB la marca 'updated' y el push manda
 * SÓLO los campos que cambiaron (`_changed`). Eso es lo que hace segura la edición
 * post-sync: un campo que el promotor no tocó no puede pisar el valor del servidor.
 *
 * El BE igual valida por su cuenta —conjunto de campos actualizables, lock rules de
 * negocio y el lock de edición concurrente— así que una solicitud que se aprobó entre
 * la edición y el sync vuelve rechazada con su motivo, no se aplica a la fuerza.
 *
 * No se tocan cosecha, zona ni compania: son contexto heredado, no campos del form.
 */
export async function actualizarSolicitud(
  solicitud: Solicitud,
  input: Omit<NuevaSolicitudInput, "idSocio" | "codigo" | "zona" | "fecha">
): Promise<void> {
  if (!solicitud.estaPendiente) {
    throw new Error(
      "Esta solicitud ya fue aprobada o rechazada; los cambios se hacen desde el ERP web."
    );
  }

  await database.write(async () => {
    await solicitud.update((rec) => {
      rec.tipoCredito = input.tipoCredito;
      rec.total = input.total;
      rec.planInversion = input.planInversion ?? null;
      rec.motivo = input.motivo ?? null;
      rec.entregaEstimada = input.entregaEstimada ?? null;
      rec.prodEstimada = input.prodEstimada ?? null;
      // Un intento anterior pudo haber quedado marcado como rechazado; al editar
      // se limpia para que el badge no siga mostrando un error ya corregido.
      rec.pushStatus = null;
      rec.pushError = null;
    });
  });
}

/**
 * Edita una visita que todavía no subió. Mismo criterio que la solicitud: es
 * puramente local mientras WatermelonDB la mantiene en 'created'.
 *
 * No se tocan cosecha ni compania (contexto heredado) ni el GPS: el punto se
 * capturó donde y cuando ocurrió la visita, y reescribirlo desde otro lugar
 * falsearía el dato. Si el GPS quedó vacío, se puede volver a intentar.
 */
export async function actualizarVisita(
  visita: Visita,
  input: Omit<NuevaVisitaInput, "fecha"> & { gpsLat?: number | null; gpsLng?: number | null }
): Promise<void> {
  if (visita.syncStatus !== "created") {
    throw new Error(
      "Esta visita ya se sincronizó; los cambios se hacen desde el ERP web."
    );
  }

  await database.write(async () => {
    await visita.update((rec) => {
      rec.idTipoVisita = input.idTipoVisita;
      rec.idSocio = input.idSocio;
      rec.recibidor = input.recibidor ?? null;
      rec.idFinca = input.idFinca ?? null;
      rec.idSolicitud = input.idSolicitudLocal ?? null;
      rec.observaciones = input.observaciones ?? null;
      rec.prodEstimadaPromotor = input.prodEstimadaPromotor ?? null;
      // Sólo se completa si faltaba; no se sobreescribe un punto ya tomado.
      if (rec.gpsLat == null && input.gpsLat != null) rec.gpsLat = input.gpsLat;
      if (rec.gpsLng == null && input.gpsLng != null) rec.gpsLng = input.gpsLng;
      // Si el reintento consiguió el punto, la omisión deja de aplicar: dejarla en 1
      // marcaría como "no se pudo" una visita que sí terminó con coordenadas.
      if (rec.gpsLat != null && rec.gpsLng != null) rec.gpsOmitido = 0;
      else if (input.gpsOmitido) rec.gpsOmitido = 1;
      rec.pushStatus = null;
      rec.pushError = null;
    });
  });
}

/**
 * Quita un entregador que todavía no subió.
 *
 * `destroyPermanently` y no `markAsDeleted`: la fila nunca existió en el servidor,
 * así que no hay nada que borrar allá. Un `markAsDeleted` la pondría en la cola de
 * push como delete y el BE la rechazaría con NOT_SUPPORTED.
 */
export async function eliminarEntregador(entregador: Entregador): Promise<void> {
  if (entregador.syncStatus !== "created") {
    throw new Error(
      "Este entregador ya se sincronizó; se quita desde el ERP web."
    );
  }
  await database.write(async () => {
    await entregador.destroyPermanently();
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
  /** Null en visitas con destino 'recibidor', que no van contra un productor. */
  idSocio: number | null;
  /** Código del recibidor. Sólo en destino 'recibidor'. */
  recibidor?: string | null;
  // cosecha NO va acá: sale de la sesión.
  idFinca?: number | null;
  /** Id local de la solicitud — sólo para tipos con requiere_solicitud. */
  idSolicitudLocal?: string | null;
  observaciones?: string | null;
  prodEstimadaPromotor?: number | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  /**
   * El tipo exigía GPS y el promotor confirmó que no había señal. Queda registrado para
   * que la oficina distinga "no se pudo" de "nadie se ocupó" — la información que el
   * legacy perdía al rechazar la visita.
   */
  gpsOmitido?: boolean;
  fecha?: Date;
}

export async function crearVisita(input: NuevaVisitaInput): Promise<Visita> {
  const { companyId, cosecha } = sesion();
  return crearConUuid<Visita>("visitas", (rec, uuid) => {
    rec.clientUuid = uuid;
    rec.idTipoVisita = input.idTipoVisita;
    rec.idSocio = input.idSocio;
    rec.recibidor = input.recibidor ?? null;
    rec.cosecha = cosecha;   // de la sesión, igual que en la solicitud
    rec.idFinca = input.idFinca ?? null;
    rec.idSolicitud = input.idSolicitudLocal ?? null;
    rec.observaciones = input.observaciones ?? null;
    rec.prodEstimadaPromotor = input.prodEstimadaPromotor ?? null;
    rec.gpsLat = input.gpsLat ?? null;
    rec.gpsLng = input.gpsLng ?? null;
    rec.gpsOmitido = input.gpsOmitido ? 1 : 0;
    rec.fecha = (input.fecha ?? new Date()).getTime();
    rec.estado = 0;
    rec.compania = companyId;
    rec.pushStatus = null;
    rec.pushError = null;
  });
}
