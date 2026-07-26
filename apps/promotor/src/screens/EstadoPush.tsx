import { Text, View } from "react-native";
import type { Model } from "@nozbe/watermelondb";
import { colores, estilos } from "./estilos";

/**
 * Badge de estado de sincronización de una fila creada en el teléfono.
 *
 * Se lee de dos fuentes complementarias:
 *   - `syncStatus` de WMDB ('created' = todavía no subió) para el caso normal
 *   - `pushStatus`/`pushError`, que escribe el syncEngine cuando el BE rechaza
 *
 * El caso UNRESOLVED_PARENT merece texto propio: no es un error del usuario ni
 * algo que pueda arreglar, es un entregador cuya solicitud padre todavía no
 * subió. Se resuelve solo en el próximo sync, y decírselo evita que reintente
 * a mano o piense que perdió el dato.
 */
export function EstadoPush({
  fila,
}: Readonly<{
  fila: Model & { pushStatus?: string | null; pushError?: string | null };
}>) {
  if (fila.pushStatus === "rejected") {
    const esPadrePendiente = fila.pushError?.startsWith("UNRESOLVED_PARENT");
    return (
      <View>
        <View
          style={[
            estilos.badge,
            {
              backgroundColor: esPadrePendiente
                ? colores.advertencia
                : colores.error,
            },
          ]}
        >
          <Text style={estilos.badgeTexto}>
            {esPadrePendiente ? "ESPERANDO SOLICITUD" : "RECHAZADO"}
          </Text>
        </View>
        <Text style={[estilos.filaSubtitulo, { color: colores.error }]}>
          {esPadrePendiente
            ? "Se envía junto con su solicitud en el próximo sync."
            : fila.pushError}
        </Text>
      </View>
    );
  }

  if (fila.syncStatus === "created") {
    return (
      <View style={[estilos.badge, { backgroundColor: colores.advertencia }]}>
        <Text style={estilos.badgeTexto}>PENDIENTE</Text>
      </View>
    );
  }

  return null;
}
