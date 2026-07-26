import * as Location from "expo-location";

export interface Punto {
  lat: number;
  lng: number;
  precisionM: number | null;
}

/**
 * Punto GPS de la visita.
 *
 * Devuelve null en vez de tirar cuando el permiso está denegado o el fix no
 * llega: la visita se guarda igual sin coordenadas. Perder la visita entera
 * porque el GPS no enganchó bajo los árboles sería mucho peor que perder el
 * punto — `rc_Visita.GpsLat/GpsLng` son nullable justamente por eso.
 *
 * Accuracy.Balanced y no Highest: bajo sombra de cafetal el fix de alta
 * precisión puede tardar más de un minuto, y para ubicar una finca alcanza con
 * ~100 m.
 */
export async function obtenerPunto(): Promise<Punto | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      precisionM: pos.coords.accuracy ?? null,
    };
  } catch (e) {
    console.warn("GPS no disponible", (e as Error)?.message);
    return null;
  }
}
