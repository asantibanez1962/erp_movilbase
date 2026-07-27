import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { colores } from "../estilos";

/**
 * Barra de filtros de las listas (solicitudes, visitas).
 *
 * Chips y no un panel plegable con inputs: el promotor filtra de pie, con una mano
 * y con guantes de trabajo. Un chip es un toque; un formulario de filtros son
 * cinco y un teclado que tapa la lista.
 *
 * Los rangos de fecha son PRESETS y no un date picker de desde/hasta por lo mismo:
 * "hoy" y "7 días" cubren casi todo lo que se busca en el campo (lo que capturé
 * recién, lo de esta semana), y elegir dos fechas a mano en un calendario chico es
 * la interacción más lenta de todo el móvil. La cosecha de la sesión sirve de tope
 * natural para "todo lo mío de este año".
 */

export type RangoFecha = "hoy" | "7d" | "30d" | "todo";

export const RANGOS: ReadonlyArray<{ valor: RangoFecha; etiqueta: string }> = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "7d", etiqueta: "7 días" },
  { valor: "30d", etiqueta: "30 días" },
  { valor: "todo", etiqueta: "Todo" },
];

/**
 * Momento desde el cual una fila entra en el rango, o null si no hay corte.
 *
 * Arranca en el comienzo del DÍA y no "hace 24 h": lo que el promotor quiere ver
 * con "hoy" es lo que capturó hoy, no lo de ayer a la tarde.
 */
export function desdeDelRango(rango: RangoFecha, ahora = Date.now()): number | null {
  if (rango === "todo") return null;
  const inicioDeHoy = new Date(ahora);
  inicioDeHoy.setHours(0, 0, 0, 0);
  const dias = rango === "hoy" ? 0 : rango === "7d" ? 6 : 29;
  return inicioDeHoy.getTime() - dias * 24 * 60 * 60 * 1000;
}

/** Fila de chips de una sola opción activa. */
export function ChipsFiltro<T extends string>({
  opciones,
  activa,
  onElegir,
}: Readonly<{
  opciones: ReadonlyArray<{ valor: T; etiqueta: string; color?: string }>;
  activa: T;
  onElegir: (v: T) => void;
}>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}
      keyboardShouldPersistTaps="handled"
    >
      {opciones.map((o) => {
        const seleccionada = o.valor === activa;
        return (
          <TouchableOpacity
            key={o.valor}
            onPress={() => onElegir(o.valor)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 16,
              borderWidth: 1,
              minHeight: 36,
              justifyContent: "center",
              borderColor: seleccionada ? colores.primario : colores.borde,
              backgroundColor: seleccionada ? colores.primario : colores.superficie,
            }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: seleccionada ? "700" : "600",
                color: seleccionada ? "#fff" : (o.color ?? colores.textoTenue),
              }}
            >
              {o.etiqueta}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/**
 * Chip de un filtro que se elige en un popup (productor, tipo de visita). Muestra
 * el valor elegido y una ✕ para limpiarlo, porque un filtro activo que no se ve es
 * la causa número uno de "no aparecen mis registros".
 */
export function ChipLookup({
  etiqueta,
  valor,
  onAbrir,
  onLimpiar,
}: Readonly<{
  etiqueta: string;
  valor: string | null;
  onAbrir: () => void;
  onLimpiar: () => void;
}>) {
  const activo = valor != null;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginHorizontal: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: activo ? colores.primario : colores.borde,
        backgroundColor: colores.superficie,
        minHeight: 44,
      }}
    >
      <TouchableOpacity
        onPress={onAbrir}
        style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 11 }}
      >
        <Text
          style={{
            fontSize: 14,
            color: activo ? colores.texto : colores.textoTenue,
            fontWeight: activo ? "600" : "400",
          }}
          numberOfLines={1}
        >
          {valor ?? etiqueta}
        </Text>
      </TouchableOpacity>
      {activo ? (
        <TouchableOpacity
          onPress={onLimpiar}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={{ paddingHorizontal: 12, paddingVertical: 8 }}
        >
          <Text style={{ color: colores.textoTenue, fontSize: 18 }}>✕</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
