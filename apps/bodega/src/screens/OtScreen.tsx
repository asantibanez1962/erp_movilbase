import React from "react";
import {
  View, Text, TextInput, Pressable, FlatList, ActivityIndicator, Alert, StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSesion } from "../lib/sesion";
import type { Props } from "../lib/rutas";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { useOpciones } from "../lib/opciones";
import { bajarOts, enviarOts } from "../lib/otApi";
import {
  COLOR_ESTADO, ESTADOS, OtsLocales, borrarOts, guardarOts, leerOts,
  pendientesDeEnviar, trasEnviarOts, vigente,
} from "../lib/otLocal";
import { mensajeDeError } from "./BuscarScreen";
import { VERDE } from "../branding";

/**
 * Lista de OT abiertas de la bodega — la primera pantalla del legacy.
 *
 * SE BAJA Y SE TRABAJA SIN SEÑAL. Igual que la toma física: el operario baja
 * las OT, marca en el piso y manda cuando vuelve a tener wifi. Por eso "Enviar"
 * es un paso explícito y el panel dice cuántas quedan sin salir del teléfono.
 *
 * LA BUSQUEDA ES POR DOCUMENTO O POR DUEÑO DEL INVENTARIO, en un solo campo. Son
 * los dos caminos por los que el operario llega —tiene el papel con el número, o
 * sabe de quién es el café— y separarlos en dos campos obligaría a decidir cuál
 * antes de escribir. Y va contra lo que ya está en el teléfono, así que
 * funciona sin señal.
 */

export function OtScreen({ navigation }: Props<"Ot">) {
  const idBodega = useSesion((s) => s.idBodega);
  const nombreBodega = useSesion((s) => s.nombreBodega);
  const opciones = useOpciones((s) => s.opciones);

  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const [datos, setDatos] = React.useState<OtsLocales | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busca, setBusca] = React.useState("");
  const [anchoLista, setAnchoLista] = React.useState(0);

  const columnas = m.columnas(anchoLista, 300);

  const recargar = React.useCallback(() => {
    if (!idBodega) return;
    leerOts(idBodega).then((d) => { setDatos(d); setCargando(false); });
  }, [idBodega]);

  React.useEffect(recargar, [recargar]);

  // Al volver de la ficha, releer el archivo: lo que se marcó allá ya se guardó.
  React.useEffect(
    () => navigation.addListener("focus", recargar),
    [navigation, recargar],
  );

  const visibles = React.useMemo(() => {
    if (!datos) return [];
    const texto = busca.trim().toLowerCase();
    if (!texto) return datos.ots;
    return datos.ots.filter(
      (o) => o.documento.toLowerCase().includes(texto) || o.socio.toLowerCase().includes(texto),
    );
  }, [datos, busca]);

  const sinEnviar = datos ? pendientesDeEnviar(datos) : 0;

  async function bajar() {
    if (!idBodega || ocupado) return;
    if (sinEnviar > 0) {
      Alert.alert(
        "Hay cambios sin enviar",
        `Tenés ${sinEnviar} OT marcada(s) que no salieron del teléfono. Si bajás de nuevo, se pierden.`,
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Enviar primero", onPress: () => void enviar() },
          { text: "Bajar igual", style: "destructive", onPress: () => void bajarAhora() },
        ],
      );
      return;
    }
    await bajarAhora();
  }

  async function bajarAhora() {
    if (!idBodega) return;
    setOcupado("bajar");
    setError(null);
    try {
      const ots = await bajarOts(idBodega);
      const siguiente: OtsLocales = {
        idBodega, bajadaAt: new Date().toISOString(), ots, cambios: {},
      };
      setDatos(siguiente);
      await guardarOts(siguiente);
      if (ots.length === 0) setError("No hay OT abiertas en esta bodega.");
    } catch (e: unknown) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function enviar() {
    if (!datos || !idBodega || ocupado) return;
    if (pendientesDeEnviar(datos) === 0) {
      Alert.alert("Nada que enviar", "Todo lo marcado ya está en el servidor.");
      return;
    }
    setOcupado("enviar");
    setError(null);
    try {
      const r = await enviarOts(idBodega, datos.cambios, datos.ots);
      const conflictivas = new Set(r.conflictos.map((c) => c.id));
      const rechazadas = new Set(r.rechazados.map((c) => c.id));

      // Se dan por resueltas las aplicadas y las que el servidor rechazó por
      // conflicto: reintentar esas las volvería a rechazar, y el servidor manda.
      // Las rechazadas por otro motivo (una OT que se cerró en el medio) quedan
      // pendientes para que el operario las vea.
      const resueltas = Object.keys(datos.cambios).map(Number)
        .filter((id) => !rechazadas.has(id));

      const delServidor: Record<string, { estado: number; avance: number }> = {};
      for (const c of r.conflictos) {
        if (c.estadoServidor != null) {
          delServidor[String(c.id)] = { estado: c.estadoServidor, avance: c.avanceServidor ?? 0 };
        }
      }

      const siguiente = trasEnviarOts(datos, resueltas, delServidor);
      setDatos(siguiente);
      await guardarOts(siguiente);

      const partes = [`${r.aplicados} OT actualizada(s).`];
      if (conflictivas.size > 0) {
        partes.push(`${conflictivas.size} las tocó otro operario y no se pisaron; quedaron como están en el servidor.`);
      }
      if (rechazadas.size > 0) {
        partes.push(`${rechazadas.size} el servidor no las aceptó: ${r.rechazados[0]?.motivo ?? ""}.`);
      }
      Alert.alert("Enviado", partes.join("\n"));
    } catch (e: unknown) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  function descartar() {
    if (!idBodega) return;
    Alert.alert(
      "Descartar del teléfono",
      "Se borra lo bajado y lo marcado sin enviar. Lo que ya se envió queda en el servidor.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Descartar", style: "destructive",
          onPress: () => { void borrarOts(idBodega).then(() => setDatos(null)); },
        },
      ],
    );
  }

  if (cargando) return <View style={s.centro}><ActivityIndicator size="large" color={VERDE} /></View>;

  return (
    <View style={s.pantalla}>
      {/* ── Columna izquierda ─────────────────────────────────────── */}
      <View style={[s.panel, { paddingLeft: m.e(10) + bordes.left }]}>
        <Text style={s.bodega} numberOfLines={1}>{nombreBodega ?? "Sin bodega"}</Text>

        <View style={s.estado}>
          <Linea s={s} etiqueta="OT abiertas" valor={String(datos?.ots.length ?? 0)} />
          <Linea s={s} etiqueta="Sin enviar" valor={String(sinEnviar)} alerta={sinEnviar > 0} />
        </View>

        <TextInput
          style={s.input}
          value={busca}
          onChangeText={setBusca}
          placeholder="OT o inventario"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          disableFullscreenUI
        />

        <View style={s.acciones}>
          <Boton s={s} texto="Bajar" tono="claro" cargando={ocupado === "bajar"} onPress={bajar} />
          {opciones.ot.registrar && (
            <Boton
              s={s}
              texto={sinEnviar > 0 ? `Enviar (${sinEnviar})` : "Enviar"}
              tono={sinEnviar > 0 ? "fuerte" : "claro"}
              cargando={ocupado === "enviar"}
              onPress={enviar}
            />
          )}
        </View>

        {datos && (
          <Pressable onPress={descartar}>
            <Text style={s.descartar}>Descartar del teléfono</Text>
          </Pressable>
        )}
      </View>

      {/* ── Columna derecha: las OT ───────────────────────────────── */}
      <View
        style={[s.derecha, { paddingRight: bordes.right }]}
        onLayout={(e) => setAnchoLista(e.nativeEvent.layout.width)}
      >
        {error && <Text style={s.error}>{error}</Text>}

        <FlatList
          data={visibles}
          keyExtractor={(o) => String(o.id)}
          numColumns={columnas}
          key={`col${columnas}`}
          columnWrapperStyle={columnas > 1 ? s.fila : undefined}
          contentContainerStyle={visibles.length === 0 ? s.centro : s.lista}
          ListEmptyComponent={
            <Text style={s.vacio}>
              {datos ? "Ninguna OT con ese texto." : "Tocá “Bajar” para traer las OT abiertas."}
            </Text>
          }
          renderItem={({ item }) => {
            const v = datos ? vigente(datos, item) : null;
            const estado = v?.estado ?? item.estado;
            const pendiente = datos ? datos.cambios[String(item.id)] !== undefined : false;
            return (
              <Pressable
                style={[s.tarjeta, { flex: 1 / columnas }, pendiente && s.tarjetaPendiente]}
                onPress={() => navigation.navigate("OtDetalle", { id: item.id })}
              >
                <View style={s.encabezado}>
                  <Text style={s.documento} numberOfLines={1}>{item.documento}</Text>
                  <View style={[s.pastilla, { backgroundColor: COLOR_ESTADO[estado] ?? "#94a3b8" }]}>
                    <Text style={s.pastillaTexto}>{ESTADOS[estado] ?? estado}</Text>
                  </View>
                </View>
                <Text style={s.socio} numberOfLines={1}>{item.socio || "—"}</Text>
                <Text style={s.detalle}>
                  {item.fecha}
                  {v?.horaInicio ? ` · inicio ${v.horaInicio}` : ""}
                  {v?.horaFin ? ` · fin ${v.horaFin}` : ""}
                  {v && v.avance > 0 ? ` · ${v.avance}%` : ""}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>
    </View>
  );
}

function Linea(
  { s, etiqueta, valor, alerta }:
  { s: Estilos; etiqueta: string; valor: string; alerta?: boolean },
) {
  return (
    <View style={s.linea}>
      <Text style={s.lineaEtiqueta}>{etiqueta}</Text>
      <Text style={[s.lineaValor, alerta && s.lineaAlerta]}>{valor}</Text>
    </View>
  );
}

function Boton(
  { s, texto, tono, cargando, onPress }:
  { s: Estilos; texto: string; tono: "claro" | "fuerte"; cargando: boolean; onPress: () => void },
) {
  return (
    <Pressable style={[s.btn, tono === "fuerte" ? s.btnFuerte : s.btnClaro]}
               onPress={onPress} disabled={cargando}>
      {cargando
        ? <ActivityIndicator color={tono === "fuerte" ? "#fff" : VERDE} />
        : <Text style={[s.btnTexto, tono === "fuerte" && s.btnTextoFuerte]}>{texto}</Text>}
    </Pressable>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    centro: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: m.e(24) },
    panel: {
      width: anchoPanel(m), backgroundColor: "#fff",
      paddingVertical: m.e(10), paddingRight: m.e(10),
      borderRightWidth: 1, borderRightColor: "#e2e8f0",
    },
    bodega: { fontSize: m.e(18), fontWeight: "700", color: VERDE, marginBottom: m.e(8) },
    estado: { marginBottom: m.e(10) },
    linea: { flexDirection: "row", justifyContent: "space-between", paddingVertical: m.e(3) },
    lineaEtiqueta: { fontSize: m.e(14), color: "#64748b" },
    lineaValor: { fontSize: m.e(15), color: "#0f172a", fontWeight: "700" },
    lineaAlerta: { color: "#b45309" },
    input: {
      height: m.t(46), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      paddingHorizontal: m.e(12), fontSize: m.e(16), backgroundColor: "#fff",
      color: "#0f172a", marginBottom: m.e(8),
    },
    acciones: { gap: m.e(6) },
    btn: { height: m.t(46), borderRadius: 8, alignItems: "center", justifyContent: "center" },
    btnClaro: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1" },
    btnFuerte: { backgroundColor: VERDE },
    btnTexto: { fontSize: m.e(16), fontWeight: "700", color: "#334155" },
    btnTextoFuerte: { color: "#fff" },
    descartar: { fontSize: m.e(13), color: "#b91c1c", marginTop: m.e(10), textAlign: "center" },
    derecha: { flex: 1 },
    error: { color: "#b91c1c", padding: m.e(10), fontSize: m.e(14) },
    lista: { padding: m.e(8), gap: m.e(8) },
    fila: { gap: m.e(8) },
    vacio: { color: "#64748b", fontSize: m.e(15), textAlign: "center" },
    tarjeta: {
      backgroundColor: "#fff", padding: m.e(12), borderRadius: 10,
      borderWidth: 1, borderColor: "#e2e8f0",
    },
    tarjetaPendiente: { borderLeftWidth: m.e(5), borderLeftColor: "#f59e0b" },
    encabezado: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: m.e(6) },
    documento: { flexShrink: 1, fontSize: m.e(19), fontWeight: "700", color: "#0f172a" },
    pastilla: { paddingHorizontal: m.e(8), paddingVertical: m.e(3), borderRadius: 999 },
    pastillaTexto: { fontSize: m.e(12), color: "#fff", fontWeight: "700" },
    socio: { fontSize: m.e(15), color: "#334155", marginTop: m.e(3) },
    detalle: { fontSize: m.e(13), color: "#64748b", marginTop: m.e(2) },
  });
}
