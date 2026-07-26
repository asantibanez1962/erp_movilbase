import { getHttpClient } from "./api";

/**
 * GET /api/mobile/contexto — lo que la app necesita ANTES del primer sync.
 *
 * No viaja como colección del sync a propósito: el pull ya está scopeado por
 * empresa y cosecha, así que hay que conocerlas para poder sincronizar. Huevo y
 * gallina que un endpoint plano resuelve en una request.
 */

export interface CosechaOpcion {
  codigo: string;
  descripcion: string | null;
}

export interface ZonaContexto {
  /** El código, que es lo que viaja en los datos (rc_solicitud.zona, ge_Socio.rc_zona). */
  codigo: string;
  /** El nombre, que es lo que el promotor reconoce ("MIRAMAR", no "5"). */
  nombre: string;
}

export interface EmpresaContexto {
  id: number;
  nombre: string;
  /** true = el usuario ve todas las zonas de esta empresa (o es admin). */
  todasLasZonas: boolean;
  /** Zonas específicas autorizadas. Informativas para la UI. */
  zonas: string[];
  /** Las mismas zonas con su nombre, para mostrar. */
  zonasNombres: ZonaContexto[];
  /** Sin zonas y sin "todas" ⇒ el usuario no tiene acceso RC en esta empresa. */
  sinAccesoRc: boolean;
  cosechaDefault: string | null;
  zonaDefault: string | null;
  cosechas: CosechaOpcion[];
}

interface RespuestaContexto {
  success: boolean;
  code: string;
  companias: EmpresaContexto[];
  /** Días que se conserva la copia local de una foto ya subida. */
  retencionFotosLocalesDias?: number;
}

export interface Contexto {
  empresas: EmpresaContexto[];
  retencionFotosLocalesDias: number;
}

export async function cargarContexto(): Promise<Contexto> {
  const http = getHttpClient();
  const resp = await http.get<RespuestaContexto>("/api/mobile/contexto");
  return {
    empresas: resp.data.companias ?? [],
    // Default igual al del servidor por si la instalación es vieja y no manda
    // la clave todavía.
    retencionFotosLocalesDias: resp.data.retencionFotosLocalesDias ?? 30,
  };
}
