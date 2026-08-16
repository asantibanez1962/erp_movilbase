import { getHttpClient } from "./api";

/**
 * GET /api/mobile/contexto — lo que la app necesita ANTES del primer sync.
 *
 * No viaja como colección del sync a propósito: el pull ya está recortado por empresa y
 * cosecha, así que hay que conocerlas para poder sincronizar. Huevo y gallina que un
 * endpoint plano resuelve en una request.
 *
 * Es el mismo endpoint que usa promotor. Lo que esta app mira y aquélla ignora son los
 * **recibidores asignados**: acá el eje del trabajo es el lugar físico, no la zona.
 */

export interface CosechaOpcion {
  codigo: string;
  descripcion: string | null;
  /**
   * ¿El servidor acepta recibos en esta cosecha? Sale de `re_cosechas.digitarrecibos`.
   *
   * ⚠️ `undefined` en servidores viejos que todavía no lo mandan. Quien filtre tiene que
   * tratar la ausencia como "sí": dejar al recibidor sin ninguna cosecha por hablar con
   * un BE desactualizado sería peor que el problema que esto resuelve.
   */
  permiteRecibos?: boolean;
}

export interface RecibidorContexto {
  /** El código, que es lo que viaja en los datos ('001'). */
  codigo: string;
  /** El nombre, que es lo que la persona reconoce ('BENEFICIO'). */
  nombre: string;
}

export interface EmpresaContexto {
  id: number;
  nombre: string;
  todasLasZonas: boolean;
  zonas: string[];
  sinAccesoRc: boolean;
  cosechaDefault: string | null;
  cosechas: CosechaOpcion[];
  /**
   * Recibidores asignados al usuario en esta empresa.
   *
   * Vacío ⇒ el usuario no tiene dónde recibir y la app no puede trabajar: hay que
   * asignárselo desde el web, en la pestaña Zonas RC. Es un caso que conviene detectar
   * al entrar y no cuando alguien intente hacer el primer recibo.
   */
  recibidores: RecibidorContexto[];
}

interface RespuestaContexto {
  success: boolean;
  code: string;
  companias: EmpresaContexto[];
}

export async function cargarContexto(): Promise<{ empresas: EmpresaContexto[] }> {
  const http = getHttpClient();
  const { data } = await http.get<RespuestaContexto>("/api/mobile/contexto");
  return { empresas: (data?.companias ?? []).map(normalizar) };
}

/**
 * El servidor puede omitir `recibidores` —lo agregó una versión posterior— y un teléfono
 * con un backend viejo recibiría `undefined`. Normalizar acá evita que cada pantalla
 * tenga que defenderse por su cuenta.
 */
function normalizar(e: EmpresaContexto): EmpresaContexto {
  return {
    ...e,
    zonas: e.zonas ?? [],
    cosechas: e.cosechas ?? [],
    recibidores: e.recibidores ?? [],
  };
}
