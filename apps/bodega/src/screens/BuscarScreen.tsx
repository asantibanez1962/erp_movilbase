import React from "react";
import {
  View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSesion } from "../lib/sesion";
import type { Props } from "../lib/rutas";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { ListaOpciones } from "../components/ListaOpciones";
import { cargarPartidas, cargarUbicaciones, Partida, Ubicacion } from "../lib/bodegaApi";
import { VERDE } from "../branding";

/**
 * Pantalla de búsqueda — el "Mover Carril" del legacy.
 *
 * DOS COLUMNAS, SIEMPRE. La app corre en horizontal en una tableta, así que el
 * ancho sobra y el alto escasea: apilar filtros encima de la lista dejaría la
 * lista en una franja de dos renglones. Los filtros van fijos a la izquierda y
 * la lista ocupa todo el resto, que es lo único que crece cuando la pantalla
 * es más grande.
 *
 * En un teléfono en horizontal —el único aparato en que se puede probar esto
 * por ahora— la misma división aguanta: el ancho sigue sobrando, y lo que
 * cambia es la escala vertical, que sale de useMedidas().
 *
 * DECISIONES PENSADAS PARA UN MONTACARGUISTA CON GUANTES:
 *
 * - Las ubicaciones son una lista con filtro, no botones en rejilla. Una
 *   bodega puede tener cincuenta carriles: en rejilla hay que barrer la
 *   pantalla con la vista para encontrar uno.
 * - Cada partida es una tarjeta entera tocable, no una fila de tabla. La
 *   grilla de cuatro columnas del legacy es de mouse.
 * - "Buscar" es explícito, no búsqueda mientras se teclea: la lista no se le
 *   mueve debajo del dedo mientras escribe.
 * - Nada de scroll horizontal.
 */

export function BuscarScreen({ navigation }: Props<"Buscar">) {
  const idBodega = useSesion((s) => s.idBodega);
  const nombreBodega = useSesion((s) => s.nombreBodega);

  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const [ubicaciones, setUbicaciones] = React.useState<Ubicacion[]>([]);
  const [ubicSel, setUbicSel] = React.useState<number | null>(null);
  const [textoPartida, setTextoPartida] = React.useState("");
  const [partidas, setPartidas] = React.useState<Partida[]>([]);
  const [cargando, setCargando] = React.useState(false);
  const [buscado, setBuscado] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [anchoLista, setAnchoLista] = React.useState(0);

  // Cuántas tarjetas caben, sobre el ancho MEDIDO de esta columna. Restarle el
  // panel al ancho de pantalla daba de más, y las tarjetas salían cortadas.
  const columnas = m.columnas(anchoLista, 260);

  // Nombre de ubicación por id, para no pedirlo por cada fila.
  const nombrePorId = React.useMemo(() => {
    const mapa = new Map<number, string>();
    for (const u of ubicaciones) mapa.set(u.id, u.nombre);
    return mapa;
  }, [ubicaciones]);

  React.useEffect(() => {
    if (!idBodega) return;
    cargarUbicaciones(idBodega).then(setUbicaciones).catch(() => setUbicaciones([]));
  }, [idBodega]);

  const buscar = React.useCallback(async () => {
    if (!idBodega) return;
    setCargando(true);
    setError(null);
    try {
      const filas = await cargarPartidas({
        idBodega,
        idUbicacion: ubicSel,
        partida: textoPartida,
      });
      setPartidas(filas);
      setBuscado(true);
    } catch (e: unknown) {
      setError(mensajeDeError(e));
    } finally {
      setCargando(false);
    }
  }, [idBodega, ubicSel, textoPartida]);

  // Al volver de mover, refrescar: la partida movida ya no está donde estaba.
  // Es lo que hace el legacy —no sale de la pantalla— y evita que el operario
  // intente mover algo que él mismo acaba de mover.
  React.useEffect(
    () => navigation.addListener("focus", () => { if (buscado) void buscar(); }),
    [navigation, buscado, buscar],
  );

  return (
    <View style={s.pantalla}>
      {/* ── Columna izquierda: filtros ─────────────────────────────── */}
      <View style={[s.panel, { paddingLeft: m.e(10) + bordes.left }]}>
        <Text style={s.bodega} numberOfLines={1}>{nombreBodega ?? "Sin bodega"}</Text>

        <TextInput
          style={s.input}
          value={textoPartida}
          onChangeText={setTextoPartida}
          placeholder="N° de partida"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          returnKeyType="search"
          onSubmitEditing={buscar}
          disableFullscreenUI
        />

        <Text style={s.etiqueta}>Ubicación</Text>
        <ListaOpciones
          m={m}
          opciones={ubicaciones}
          seleccionado={ubicSel}
          alElegir={(u) => setUbicSel(u.id)}
          encabezado={{
            texto: "Todas",
            activo: ubicSel == null,
            alTocar: () => setUbicSel(null),
          }}
          vacio="Esta bodega no tiene ubicaciones por documento."
        />

        <Pressable style={s.btnBuscar} onPress={buscar} disabled={cargando}>
          {cargando
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnBuscarTexto}>Buscar</Text>}
        </Pressable>
      </View>

      {/* ── Columna derecha: resultados ────────────────────────────── */}
      <View
        style={[s.resultados, { paddingRight: bordes.right }]}
        onLayout={(e) => setAnchoLista(e.nativeEvent.layout.width)}
      >
        {error && <Text style={s.error}>{error}</Text>}

        {cargando ? (
          <View style={s.centro}><ActivityIndicator size="large" color={VERDE} /></View>
        ) : (
          <FlatList
            data={partidas}
            keyExtractor={(p) => String(p.id)}
            numColumns={columnas}
            // numColumns no se puede cambiar en caliente: la key remonta la
            // lista cuando la tableta rota o cambia de tamaño.
            key={`col${columnas}`}
            columnWrapperStyle={columnas > 1 ? s.fila : undefined}
            contentContainerStyle={partidas.length === 0 ? s.centro : s.lista}
            ListEmptyComponent={
              <Text style={s.vacio}>
                {buscado
                  ? "No hay partidas con esos filtros."
                  : "Elegí una ubicación y tocá Buscar."}
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                style={[s.tarjeta, { flex: 1 / columnas }]}
                onPress={() => navigation.navigate("Mover", {
                  partida: { ...item, ubicacion: nombrePorId.get(item.idUbicacion) ?? "" },
                })}
              >
                <Text style={s.partida} numberOfLines={1}>{item.partida}</Text>
                <Text style={s.detalle}>
                  {formatear(item.sacos)} sacos · {formatear(item.peso)} kg
                </Text>
                <Text style={s.ubicacion} numberOfLines={1}>
                  {nombrePorId.get(item.idUbicacion) ?? ""}
                  {item.calidad ? ` · ${item.calidad}` : ""}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </View>
  );
}

function formatear(n: number) {
  return n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function mensajeDeError(e: unknown): string {
  const err = e as { response?: { data?: { message?: string } }; message?: string };
  return err?.response?.data?.message ?? err?.message ?? "No se pudo completar la operación.";
}

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    // paddingLeft lo pone el componente, sumando el recorte de la cámara.
    panel: {
      width: anchoPanel(m),
      backgroundColor: "#fff",
      paddingVertical: m.e(10),
      paddingRight: m.e(10),
      borderRightWidth: 1,
      borderRightColor: "#e2e8f0",
    },
    bodega: { fontSize: m.e(18), fontWeight: "700", color: VERDE, marginBottom: m.e(8) },
    etiqueta: { fontSize: m.e(13), color: "#64748b", marginTop: m.e(10), marginBottom: m.e(4) },
    input: {
      height: m.t(46), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(12), fontSize: m.e(17), backgroundColor: "#fff", color: "#0f172a",
    },
    btnBuscar: {
      height: m.t(50), borderRadius: 8, backgroundColor: VERDE, marginTop: m.e(8),
      alignItems: "center", justifyContent: "center",
    },
    btnBuscarTexto: { color: "#fff", fontSize: m.e(17), fontWeight: "700" },
    resultados: { flex: 1 },
    lista: { padding: m.e(10), gap: m.e(8) },
    fila: { gap: m.e(8) },
    centro: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: m.e(24) },
    vacio: { color: "#64748b", fontSize: m.e(15), textAlign: "center" },
    error: { color: "#b91c1c", padding: m.e(12), fontSize: m.e(14) },
    tarjeta: {
      backgroundColor: "#fff", padding: m.e(14),
      borderRadius: 10, borderWidth: 1, borderColor: "#e2e8f0",
    },
    partida: { fontSize: m.e(20), fontWeight: "700", color: "#0f172a" },
    detalle: { fontSize: m.e(15), color: "#475569", marginTop: 3 },
    ubicacion: { fontSize: m.e(14), color: VERDE, marginTop: 3, fontWeight: "600" },
  });
}
