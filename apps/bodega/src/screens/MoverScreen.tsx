import React from "react";
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, Alert, StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSesion } from "../lib/sesion";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { ListaOpciones } from "../components/ListaOpciones";
import { cargarUbicaciones, moverPartida, Ubicacion } from "../lib/bodegaApi";
import type { Props } from "../lib/rutas";
import { mensajeDeError } from "./BuscarScreen";
import { VERDE } from "../branding";

/**
 * Pantalla de movimiento — el "Cambio de Ubicación" del legacy.
 *
 * A la izquierda la partida elegida, sólo lectura. A la derecha lo único que
 * se decide —a qué ubicación va— y los botones. El destino es una LISTA con
 * filtro y no botones en rejilla: una bodega puede tener cincuenta carriles, y
 * en rejilla eso es una pared de botones donde hay que buscar con la vista. La misma división de dos
 * columnas que la pantalla anterior, por la misma razón: en horizontal el alto
 * es el recurso escaso, y con la ficha arriba las ubicaciones quedarían en una
 * franja donde no se puede tocar nada sin apuntar.
 *
 * SE MUEVE LA PARTIDA COMPLETA. No hay cantidad que digitar, y por eso no hay
 * teclado numérico ni validaciones de saldo: el montacarguista lleva la tarima
 * entera. Los sacos y el peso se muestran para que confirme que es la que
 * tiene enfrente, no para editarlos.
 *
 * EL UUID SE GENERA UNA VEZ POR PANTALLA, no por intento. Si la respuesta se
 * pierde y el operario vuelve a tocar "Mover", el servidor reconoce el mismo
 * identificador y devuelve el documento que ya creó, en lugar de mover el café
 * dos veces. Regenerarlo en cada toque anularía esa protección, que es
 * justamente para el wifi flojo de una bodega.
 */

export function MoverScreen({ route, navigation }: Props<"Mover">) {
  const { partida } = route.params;
  const idBodega = useSesion((s) => s.idBodega);

  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const [ubicaciones, setUbicaciones] = React.useState<Ubicacion[]>([]);
  const [destino, setDestino] = React.useState<Ubicacion | null>(null);
  const [enviando, setEnviando] = React.useState(false);

  const uuid = React.useRef(nuevoUuid()).current;

  React.useEffect(() => {
    if (!idBodega) return;
    cargarUbicaciones(idBodega)
      // La ubicación actual no puede ser destino de sí misma.
      .then((us) => setUbicaciones(us.filter((u) => u.id !== partida.idUbicacion)))
      .catch(() => setUbicaciones([]));
  }, [idBodega, partida.idUbicacion]);

  async function mover() {
    if (!destino || enviando) return;
    setEnviando(true);
    try {
      const r = await moverPartida({
        idOrigenDetalle: partida.id,
        idUbicacionDestino: destino.id,
        clientUuid: uuid,
      });
      Alert.alert(
        r.repetido ? "Ya estaba registrado" : "Movimiento registrado",
        `Documento ${r.documento}\n${partida.partida} → ${destino.nombre}`,
        [{ text: "Listo", onPress: () => navigation.goBack() }],
      );
    } catch (e: unknown) {
      // El backend responde con un motivo entendible —"ya no tiene existencia",
      // "es de otra bodega"— y se muestra tal cual. No se traduce ni se
      // resume: el operario tiene que poder leerlo y decidir qué hace con el
      // café que ya movió.
      Alert.alert("No se pudo mover", mensajeDeError(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <View style={s.pantalla}>
      {/* ── Columna izquierda: qué se está moviendo ────────────────── */}
      {/* El ancho va en un View y NO en el ScrollView: un ScrollView con
          width propio se estira con su contenido y esta ficha se comia dos
          tercios de la pantalla, dejando los destinos sin lugar. */}
      <View style={[s.panel, { paddingLeft: bordes.left }]}>
        <ScrollView contentContainerStyle={s.panelContenido}>
          <Text style={s.partida} numberOfLines={1} adjustsFontSizeToFit>
            {partida.partida}
          </Text>
          <Dato s={s} etiqueta="Sacos" valor={formatear(partida.sacos)} />
          <Dato s={s} etiqueta="Peso neto" valor={`${formatear(partida.peso)} kg`} />
          {partida.calidad ? <Dato s={s} etiqueta="Calidad" valor={partida.calidad} /> : null}
          <Dato s={s} etiqueta="Ubicación" valor={partida.ubicacion} />
        </ScrollView>
      </View>

      {/* ── Columna derecha: a dónde va, y el botón ────────────────── */}
      <View style={[s.derecha, { paddingRight: bordes.right }]}>
        <Text style={s.titulo}>Mover a</Text>

        <ListaOpciones
          m={m}
          opciones={ubicaciones}
          seleccionado={destino?.id ?? null}
          alElegir={setDestino}
          vacio="No hay otra ubicación disponible en esta bodega."
        />

        <View style={s.pie}>
          <Pressable style={s.btnCancelar} onPress={() => navigation.goBack()} disabled={enviando}>
            <Text style={s.btnCancelarTexto}>Cancelar</Text>
          </Pressable>
          <Pressable
            style={[s.btnMover, (!destino || enviando) && s.btnApagado]}
            onPress={mover}
            disabled={!destino || enviando}
          >
            {enviando
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.btnMoverTexto}>MOVER</Text>}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Dato({ s, etiqueta, valor }: { s: Estilos; etiqueta: string; valor: string }) {
  return (
    <View style={s.dato}>
      <Text style={s.datoEtiqueta}>{etiqueta}</Text>
      <Text style={s.datoValor} numberOfLines={2}>{valor}</Text>
    </View>
  );
}

function formatear(n: number) {
  return n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** uuid v4 sin dependencias: alcanza de sobra para identificar un intento. */
function nuevoUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    panel: {
      width: anchoPanel(m),
      backgroundColor: "#fff",
      borderRightWidth: 1,
      borderRightColor: "#e2e8f0",
    },
    // El ancho de arriba manda: sin esto, un nombre de ubicacion largo
    // ensancha la columna y se la quita a los destinos.

    panelContenido: { padding: m.e(14) },
    partida: { fontSize: m.e(26), fontWeight: "700", color: "#0f172a", marginBottom: m.e(8) },
    dato: { flexDirection: "row", justifyContent: "space-between", gap: m.e(8), paddingVertical: m.e(5) },
    datoEtiqueta: { fontSize: m.e(15), color: "#64748b" },
    datoValor: { flexShrink: 1, fontSize: m.e(16), color: "#0f172a", fontWeight: "600", textAlign: "right" },
    derecha: { flex: 1 },
    titulo: { fontSize: m.e(14), color: "#64748b", marginLeft: m.e(12), marginTop: m.e(8) },
    pie: {
      flexDirection: "row", gap: m.e(10), padding: m.e(10),
      borderTopWidth: 1, borderTopColor: "#e2e8f0", backgroundColor: "#fff",
    },
    btnCancelar: {
      flex: 1, height: m.t(56), borderRadius: 10, alignItems: "center", justifyContent: "center",
      backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1",
    },
    btnCancelarTexto: { fontSize: m.e(17), color: "#475569", fontWeight: "600" },
    btnMover: {
      flex: 2, height: m.t(56), borderRadius: 10, alignItems: "center", justifyContent: "center",
      backgroundColor: VERDE,
    },
    btnApagado: { backgroundColor: "#cbd5e1" },
    btnMoverTexto: { fontSize: m.e(20), color: "#fff", fontWeight: "700", letterSpacing: 1 },
  });
}
