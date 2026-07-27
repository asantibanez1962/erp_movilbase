import { useEffect, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { observarEventos } from "../lib/bitacora";
import { useSesion } from "../lib/sesion";
import { EventoBitacora } from "../db/models";
import { colores, estilos, fmtFechaHora } from "./estilos";

/**
 * Bitácora del teléfono: cada sincronización y cada consulta a Hacienda.
 *
 * Para qué sirve en la práctica: cuando el promotor llama diciendo "no envió nada" o
 * "sigue todo pendiente", esta pantalla se lee por teléfono en treinta segundos y dice
 * si el sync corrió, cuántas filas subieron y qué rechazó el servidor con su motivo.
 * Antes de esto la única fuente era el logcat, o sea un cable y una computadora.
 *
 * El detalle se despliega tocando la fila y no se muestra siempre: el resumen es lo
 * que se dicta por teléfono, y el JSON completo sólo estorba hasta que hace falta.
 */
export function BitacoraScreen() {
  const [eventos, setEventos] = useState<EventoBitacora[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const retencionDias = useSesion((s) => s.retencionFotosDias);

  // Suscripción viva y no una carga única: el drawer mantiene esta pantalla montada, así
  // que un `useEffect` de montaje la dejaba con los datos del primer día que se abrió.
  // El síntoma era desconcertante —"sincronizo y no aparece nada en la bitácora"— con los
  // eventos escribiéndose correctamente en la base.
  useEffect(() => {
    const sub = observarEventos().subscribe((filas: EventoBitacora[]) => {
      setEventos(filas);
    });
    return () => sub.unsubscribe();
  }, []);

  return (
    <View style={estilos.root}>
      <FlatList
        data={eventos}
        keyExtractor={(e) => e.id}
        // Sin pull-to-refresh: la lista es una suscripcion viva, se actualiza sola.
        ListHeaderComponent={
          <Text
            style={[
              estilos.vacioTexto,
              { paddingHorizontal: 16, paddingTop: 14, textAlign: "left" },
            ]}
          >
            Últimas sincronizaciones y consultas a Hacienda de este teléfono. Se
            conservan {retencionDias} días, igual que las copias locales de los
            adjuntos; el histórico completo queda en el ERP.
          </Text>
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              Todavía no hay eventos registrados.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const desplegado = abierto === item.id;
          return (
            <TouchableOpacity
              style={estilos.fila}
              onPress={() => setAbierto(desplegado ? null : item.id)}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={{ fontSize: 16, marginRight: 8 }}>
                  {item.ok ? "✓" : "⚠"}
                </Text>
                <Text
                  style={[
                    estilos.filaTitulo,
                    { flex: 1, color: item.ok ? colores.texto : colores.error },
                  ]}
                >
                  {item.resumen}
                </Text>
              </View>
              <Text style={estilos.filaSubtitulo}>
                {etiquetaTipo(item.tipo)} · {fmtFechaHora(item.createdAt)}
                {item.duracionMs != null
                  ? ` · ${(item.duracionMs / 1000).toFixed(1)} s`
                  : ""}
              </Text>

              {item.error ? (
                <Text style={[estilos.filaSubtitulo, { color: colores.error }]}>
                  {item.error}
                </Text>
              ) : null}

              {desplegado && item.detalle ? (
                <Text
                  style={{
                    fontSize: 11,
                    color: colores.textoTenue,
                    marginTop: 8,
                    fontFamily: "monospace",
                  }}
                >
                  {formatearDetalle(item.detalle)}
                </Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function etiquetaTipo(tipo: string): string {
  if (tipo === "sync") return "Sincronización";
  if (tipo === "atv") return "Hacienda";
  return tipo;
}

/**
 * JSON indentado. Si el detalle no parsea se muestra crudo: es diagnóstico, y un
 * texto feo sirve más que un "no se pudo mostrar".
 */
function formatearDetalle(detalle: string): string {
  try {
    return JSON.stringify(JSON.parse(detalle), null, 2);
  } catch {
    return detalle;
  }
}
