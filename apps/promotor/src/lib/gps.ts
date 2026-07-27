import * as Location from "expo-location";
import { permisoUbicacion } from "./permisos";

export interface Punto {
  lat: number;
  lng: number;
  precisionM: number | null;
}

/** Por qué no hay punto. Lo usa la pantalla para decir qué hacer al respecto. */
export type MotivoSinPunto = "sin-permiso" | "sin-senal";

export interface ResultadoGps {
  punto: Punto | null;
  motivo: MotivoSinPunto | null;
}

/**
 * Punto GPS de la visita.
 *
 * Nunca tira: la visita se guarda igual sin coordenadas. Perderla entera porque el
 * GPS no enganchó bajo los árboles sería mucho peor que perder el punto —
 * `rc_Visita.GpsLat/GpsLng` son nullable justamente por eso.
 *
 * Accuracy.Balanced y no Highest: bajo sombra de cafetal el fix de alta precisión
 * puede tardar más de un minuto, y para ubicar una finca alcanza con ~100 m.
 *
 * `pedirPermiso` es false por defecto —el permiso se pide una vez al entrar al
 * contexto de trabajo (lib/permisos.ts)— porque un diálogo de sistema en medio de
 * la captura interrumpe, y para sacárselo de encima se toca "Solo esta vez", que
 * Android revoca al rato: el resultado es que pregunta de nuevo cada visita. Cuando
 * el promotor toca la fila del GPS para reintentar sí se pide, porque ahí el diálogo
 * es la respuesta a algo que él pidió.
 *
 * Distinguir "sin permiso" de "sin señal" importa: son problemas distintos y con
 * soluciones distintas, y mostrarlos igual manda a buscar señal a alguien que sólo
 * tiene que tocar un botón.
 */
export async function obtenerPunto(pedirPermiso = false): Promise<ResultadoGps> {
  try {
    const permiso = await permisoUbicacion(pedirPermiso);
    if (!permiso.concedido) return { punto: null, motivo: "sin-permiso" };

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      punto: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        precisionM: pos.coords.accuracy ?? null,
      },
      motivo: null,
    };
  } catch (e) {
    console.warn("GPS no disponible", (e as Error)?.message);
    return { punto: null, motivo: "sin-senal" };
  }
}
