import { StyleSheet } from "react-native";

/**
 * Paleta y estilos comunes a las pantallas. En recibos-cr cada screen repetía
 * su propio StyleSheet con los mismos hex; acá se comparten desde el principio.
 */
export const colores = {
  fondo: "#f8fafc",
  fondoOscuro: "#0f172a",
  superficie: "#ffffff",
  superficieOscura: "#1e293b",
  borde: "#e2e8f0",
  texto: "#0f172a",
  textoTenue: "#64748b",
  textoClaro: "#f1f5f9",
  primario: "#3b82f6",
  exito: "#16a34a",
  advertencia: "#d97706",
  error: "#dc2626",
};

export const estilos = StyleSheet.create({
  root: { flex: 1, backgroundColor: colores.fondo },
  center: { justifyContent: "center", alignItems: "center", padding: 24 },
  loadingText: { color: colores.textoTenue, marginTop: 12 },

  buscador: {
    backgroundColor: colores.superficie,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    margin: 12,
    color: colores.texto,
  },

  fila: {
    backgroundColor: colores.superficie,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
    // 48dp mínimo de área táctil — corrección que ya se aplicó en recibos-cr.
    minHeight: 56,
    justifyContent: "center",
  },
  filaTitulo: { fontSize: 16, fontWeight: "600", color: colores.texto },
  filaSubtitulo: { fontSize: 13, color: colores.textoTenue, marginTop: 2 },

  vacio: { padding: 32, alignItems: "center" },
  vacioTexto: { color: colores.textoTenue, textAlign: "center", fontSize: 14 },

  badge: {
    alignSelf: "flex-start",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 6,
  },
  badgeTexto: { fontSize: 11, fontWeight: "700", color: "#fff" },

  seccion: {
    fontSize: 12,
    fontWeight: "700",
    color: colores.textoTenue,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 6,
  },
  detalleFila: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colores.superficie,
    borderBottomWidth: 1,
    borderBottomColor: colores.borde,
  },
  detalleEtiqueta: { color: colores.textoTenue, fontSize: 14 },
  detalleValor: {
    color: colores.texto,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
  error: { color: colores.error, fontSize: 13, padding: 12 },
});

/** Formato de moneda para colones, sin decimales (el ERP trabaja en enteros). */
export function fmtMoneda(valor: number | null | undefined): string {
  if (valor == null) return "—";
  return `₡ ${Math.round(valor).toLocaleString("es-CR")}`;
}

export function fmtFecha(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return new Date(ms).toLocaleDateString("es-CR");
}

/** Con hora — la bitácora necesita distinguir dos sincronizaciones del mismo día. */
export function fmtFechaHora(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${d.toLocaleDateString("es-CR")} ${d.toLocaleTimeString("es-CR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Cajuelas y cuartillos como los dice la operación: "17 · 3". */
export function fmtCajuelas(
  cajuelas: number | null | undefined,
  cuartillos: number | null | undefined
): string {
  return `${cajuelas ?? 0} · ${cuartillos ?? 0}`;
}
