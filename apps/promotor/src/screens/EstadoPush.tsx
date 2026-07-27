import { Text, View } from "react-native";
import type { Model } from "@nozbe/watermelondb";
import { colores, estilos } from "./estilos";

/**
 * Badge de estado de sincronización de una fila creada en el teléfono.
 *
 * QUIÉN MANDA: `syncStatus` de WatermelonDB.
 *
 * Si la fila está 'synced', ESTÁ en el servidor. Es dato duro —lo puso WMDB al
 * confirmar el push— y cualquier `pushStatus` que haya quedado es basura de un intento
 * anterior. El engine escribe `pushStatus='rejected'` cuando el BE rechaza, pero NUNCA
 * lo limpia al tener éxito, y no puede: escribir en una fila ya sincronizada la
 * marcaría 'updated' y la re-empujaría.
 *
 * Preguntar por `pushStatus` primero —como hacía la primera versión— dejaba una fila
 * que falló una vez y después subió bien mostrando RECHAZADO para siempre, con el
 * contador de pendientes en cero. El usuario veía un error sobre un registro que
 * estaba perfectamente guardado en el ERP.
 *
 * El caso UNRESOLVED_PARENT merece texto propio: no es un error del usuario ni algo que
 * pueda arreglar, es un entregador cuya solicitud padre todavía no subió. Se resuelve
 * solo en el próximo sync, y decírselo evita que reintente a mano o crea que perdió el
 * dato.
 */
export function EstadoPush({
  fila,
}: Readonly<{
  fila: Model & { pushStatus?: string | null; pushError?: string | null };
}>) {
  // Ya está en el servidor: nada que mostrar, sin importar qué haya pasado antes.
  if (fila.syncStatus === "synced") return null;

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

  return (
    <View style={[estilos.badge, { backgroundColor: colores.advertencia }]}>
      <Text style={estilos.badgeTexto}>PENDIENTE</Text>
    </View>
  );
}
