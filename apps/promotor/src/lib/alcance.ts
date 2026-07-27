import { database } from "./db";
import { useSesion } from "./sesion";
import { cargarContexto } from "./contexto";
import { registrarEvento } from "./bitacora";
import { rebajarTodo, resumenPendientes, describirPendientes } from "./rebajar";

/**
 * El ALCANCE de la base local: a qué (usuario, empresa, cosecha, zonas) pertenecen los
 * datos que hay en el teléfono.
 *
 * POR QUÉ ESTO NECESITA CÓDIGO PROPIO
 * -----------------------------------
 * El pull es un DELTA: pide las filas con `SyncUpdatedAt > lastPulledAt`. Eso funciona
 * mientras el FILTRO no cambie. Cuando cambia —le agregan una zona al promotor, cambia
 * de cosecha, o se loguea otro usuario— las filas que ahora SÍ le corresponden no
 * cambiaron del lado del servidor, así que no entran en ningún delta y el teléfono no
 * las ve nunca.
 *
 * Ya nos pasó tres veces con la misma forma: al cambiar de cosecha (resuelto con
 * reset), al escribir el veredicto ATV sin mover SyncUpdatedAt, y ahora al ampliar las
 * zonas autorizadas de un usuario. La regla general es:
 *
 *   un cambio de ALCANCE no se arregla sincronizando; hay que rebajar todo.
 */

/** Firma comparable del alcance. Zonas ordenadas: el orden del servidor no es estable. */
function firma(companyId: number | null, cosecha: string | null, zonas: string[]): string {
  return `${companyId ?? "-"}|${cosecha ?? "-"}|${[...zonas].sort().join(",")}`;
}

/**
 * Verifica contra el servidor si las zonas autorizadas del usuario cambiaron y, si es
 * así, rebaja todos los datos.
 *
 * Se llama al arrancar la app con sesión ya elegida. Requiere conexión; sin ella no
 * hace nada — el promotor sigue trabajando con lo que tiene, y se revisa la próxima vez.
 *
 * NO descarta trabajo pendiente: usa el camino seguro de `rebajarTodo`. Si queda algo
 * sin subir, devuelve el aviso para que la pantalla lo muestre en vez de resetear por
 * su cuenta. Perder una solicitud del campo por un cambio de permisos en la oficina
 * sería el peor intercambio posible.
 */
export async function verificarAlcance(): Promise<{ cambio: boolean; aviso?: string }> {
  const s = useSesion.getState();
  if (s.companyId == null) return { cambio: false };

  let zonasServidor: string[];
  let todasServidor: boolean;
  try {
    const { empresas } = await cargarContexto();
    const empresa = empresas.find((e) => e.id === s.companyId);
    if (!empresa) return { cambio: false };
    zonasServidor = empresa.zonas;
    todasServidor = empresa.todasLasZonas;
  } catch {
    // Sin señal. No es un error: se revisa la próxima vez que haya.
    return { cambio: false };
  }

  const antes = firma(s.companyId, s.cosecha, s.zonas);
  const ahora = firma(s.companyId, s.cosecha, zonasServidor);
  if (antes === ahora && todasServidor === s.todasLasZonas) return { cambio: false };

  await registrarEvento({
    tipo: "sync",
    ok: true,
    resumen: "Cambiaron las zonas autorizadas — rebajando todos los datos",
    detalle: { zonasAntes: s.zonas, zonasAhora: zonasServidor },
  });

  // La sesión se actualiza ANTES de rebajar: el pull completo tiene que salir con el
  // alcance nuevo, no con el viejo.
  await s.elegir({
    companyId: s.companyId,
    cosecha: s.cosecha ?? "",
    zonas: zonasServidor,
    zonasNombres: s.zonasNombres,
    todasLasZonas: todasServidor,
  });

  const pendientes = await resumenPendientes();
  if (pendientes.total > 0) {
    // Se intenta subir dentro de rebajarTodo; si igual queda algo, no se resetea.
    try {
      await rebajarTodo({ descartar: false });
      return { cambio: true };
    } catch {
      return {
        cambio: true,
        aviso:
          `Cambiaron tus zonas, pero todavía no subieron: ${describirPendientes(pendientes)}. ` +
          "Sincronizá y después usá “Rebajar todos los datos” para ver la zona nueva.",
      };
    }
  }

  await rebajarTodo({ descartar: false });
  return { cambio: true };
}

/**
 * Cierra la sesión de verdad: credenciales, contexto Y datos locales.
 *
 * Borrar la base NO es exceso de celo. El cache local pertenece a un usuario y a su
 * alcance; si queda, el próximo que entre hereda empresa, cosecha y —lo grave— los
 * productores y solicitudes del anterior. Y un delta jamás lo va a corregir, porque
 * esas filas no cambiaron del lado del servidor: simplemente dejaron de
 * corresponderle.
 *
 * `descartar` sigue el mismo criterio que rebajar: si hay trabajo sin subir, quien
 * llama tiene que haber avisado y pedido confirmación. Cerrar sesión no puede ser una
 * forma silenciosa de perder la mañana de alguien.
 */
export async function cerrarSesion(opts: { descartar: boolean }): Promise<void> {
  const pendientes = await resumenPendientes();
  if (pendientes.total > 0 && !opts.descartar) {
    throw new Error(
      `Quedan sin enviar: ${describirPendientes(pendientes)}. ` +
        "Sincronizá antes de cerrar sesión, o confirmá que se descarten."
    );
  }

  await database.write(async () => {
    await database.unsafeResetDatabase();
  });

  await useSesion.getState().limpiar();
  // Remontar: el reset deja las pantallas con suscripciones muertas. Ver sesion.ts.
  useSesion.getState().remontar();
}
