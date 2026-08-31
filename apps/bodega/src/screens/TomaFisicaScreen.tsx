import React from "react";
import {
  View, Text, TextInput, Pressable, FlatList, Modal, ActivityIndicator, Alert, StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSesion } from "../lib/sesion";
import type { Props } from "../lib/rutas";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { ListaOpciones } from "../components/ListaOpciones";
import { useOpciones } from "../lib/opciones";
import { bajarToma, crearToma, enviarToma } from "../lib/tomaApi";
import {
  FilaToma, TomaLocal, borrarToma, conConteo, guardarToma, hoyLocal, leerToma,
  resumenLocal, trasEnviar, valorDe,
} from "../lib/tomaLocal";
import { mensajeDeError, VERDE } from "./BuscarScreen";

/**
 * Toma física de inventario.
 *
 * EL FLUJO ES: Crear (conectado) → bajar → digitar sin señal → enviar.
 * A diferencia del cambio de ubicación —donde el café ya se movió y hay que
 * confirmarlo en el momento— acá el operario recorre la bodega anotando, y
 * entre los carriles puede no haber wifi. Por eso hay archivo local, y por eso
 * "enviar" es un paso explícito y no algo que pase solo: el operario tiene que
 * poder saber si su trabajo ya salió del teléfono.
 *
 * NO SE VE LO QUE EL SISTEMA ESPERA. Ni sacos ni peso. No es que no se dibujen:
 * el servidor no los manda. Si el operario ve el número esperado, lo que anota
 * deja de ser un conteo y pasa a ser una confirmación, y la toma física deja de
 * servir para lo único que sirve, que es encontrar diferencias.
 *
 * EL CAMPO VACIO NO ES CERO. Vacío = no lo conté todavía; 0 = fui, miré, y el
 * carril está vacío —que es un hallazgo real de inventario—. Se ven distinto en
 * la lista a propósito.
 */

export function TomaFisicaScreen({ navigation }: Props<"TomaFisica">) {
  const idBodega = useSesion((s) => s.idBodega);
  const nombreBodega = useSesion((s) => s.nombreBodega);
  const opciones = useOpciones((s) => s.opciones);

  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const fecha = React.useRef(hoyLocal()).current;

  const [toma, setToma] = React.useState<TomaLocal | null>(null);
  const [cargando, setCargando] = React.useState(true);
  const [ocupado, setOcupado] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ubicSel, setUbicSel] = React.useState<number | null>(null);
  const [verUbicaciones, setVerUbicaciones] = React.useState(false);
  const [soloPendientes, setSoloPendientes] = React.useState(false);
  const [busca, setBusca] = React.useState("");

  React.useEffect(() => {
    if (!idBodega) return;
    leerToma(idBodega, fecha).then((t) => { setToma(t); setCargando(false); });
  }, [idBodega, fecha]);

  const resumen = toma ? resumenLocal(toma) : null;

  // Las ubicaciones salen de la toma bajada, no de un endpoint: son exactamente
  // las que tienen café que contar, y funcionan sin señal.
  const ubicaciones = React.useMemo(() => {
    const mapa = new Map<number, string>();
    for (const f of toma?.filas ?? []) if (f.idUbicacion) mapa.set(f.idUbicacion, f.ubicacion);
    return [...mapa.entries()]
      .map(([id, nombre]) => ({ id, nombre }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [toma]);

  const visibles = React.useMemo(() => {
    if (!toma) return [];
    const texto = busca.trim().toLowerCase();
    return toma.filas
      .filter((f) => (ubicSel == null || f.idUbicacion === ubicSel))
      .filter((f) => (!soloPendientes || valorDe(toma, f) === null))
      .filter((f) => (!texto || f.partida.toLowerCase().includes(texto)))
      .sort((a, b) => a.ubicacion.localeCompare(b.ubicacion) || a.partida.localeCompare(b.partida));
  }, [toma, ubicSel, soloPendientes, busca]);

  async function guardar(siguiente: TomaLocal) {
    setToma(siguiente);
    await guardarToma(siguiente);
  }

  function digitar(fila: FilaToma, texto: string) {
    if (!toma) return;
    const limpio = texto.trim();
    if (limpio === "") { void guardar(conConteo(toma, fila.id, null)); return; }
    const n = Number(limpio.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return;
    void guardar(conConteo(toma, fila.id, n));
  }

  async function crear() {
    if (!idBodega || ocupado) return;
    setOcupado("crear");
    setError(null);
    try {
      const r = await crearToma(idBodega, fecha);
      const filas = await bajarToma(idBodega, fecha);
      await guardar({ idBodega, fecha, bajadaAt: new Date().toISOString(), filas, conteos: {} });
      Alert.alert("Toma creada", `${r.creadas} partida(s) para contar.`);
    } catch (e: unknown) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function bajar() {
    if (!idBodega || ocupado) return;

    // Bajar reemplaza lo que hay en el teléfono. Si quedaron conteos sin
    // enviar, eso los borra: hay que decirlo antes, no después.
    const sinEnviar = toma ? Object.keys(toma.conteos).length : 0;
    if (sinEnviar > 0) {
      Alert.alert(
        "Hay conteos sin enviar",
        `Tenés ${sinEnviar} conteo(s) que todavía no salieron del teléfono. Si bajás de nuevo, se pierden.`,
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
      const filas = await bajarToma(idBodega, fecha);
      if (filas.length === 0) {
        setError("No hay toma creada para hoy en esta bodega. Tocá “Crear toma”.");
        return;
      }
      await guardar({ idBodega, fecha, bajadaAt: new Date().toISOString(), filas, conteos: {} });
    } catch (e: unknown) {
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  async function enviar() {
    if (!toma || !idBodega || ocupado) return;
    const pendientes = Object.keys(toma.conteos).length;
    if (pendientes === 0) { Alert.alert("Nada que enviar", "Todos los conteos ya están en el servidor."); return; }

    setOcupado("enviar");
    setError(null);
    try {
      const r = await enviarToma(idBodega, fecha, toma.conteos);
      const resueltos = [
        ...Object.keys(toma.conteos).map(Number).filter(
          (id) => !r.noEncontrados.includes(id)),
      ];
      await guardar(trasEnviar(toma, resueltos));

      const partes = [`${r.aplicados} conteo(s) guardado(s).`];
      if (r.conflictos.length > 0) {
        partes.push(`${r.conflictos.length} ya los había contado otro operario y no se pisaron.`);
      }
      if (r.noEncontrados.length > 0) {
        partes.push(`${r.noEncontrados.length} no existen en el servidor; quedan pendientes.`);
      }
      partes.push(`Faltan ${r.pendientes} por contar en la bodega.`);
      Alert.alert("Enviado", partes.join("\n"));
    } catch (e: unknown) {
      // No se toca el archivo local: si el envío falló, lo digitado sigue
      // pendiente y se puede reintentar. Es la razón de que "enviar" sea un
      // paso explícito.
      setError(mensajeDeError(e));
    } finally {
      setOcupado(null);
    }
  }

  function descartar() {
    if (!toma || !idBodega) return;
    Alert.alert(
      "Descartar la toma del teléfono",
      "Se borra lo bajado y lo digitado sin enviar. Lo que ya se envió queda en el servidor.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Descartar",
          style: "destructive",
          onPress: () => { void borrarToma(idBodega, fecha).then(() => setToma(null)); },
        },
      ],
    );
  }

  if (cargando) {
    return <View style={s.centro}><ActivityIndicator size="large" color={VERDE} /></View>;
  }

  const nombreUbic = ubicSel == null
    ? "Todas"
    : (ubicaciones.find((u) => u.id === ubicSel)?.nombre ?? "Todas");

  return (
    <View style={s.pantalla}>
      {/* ── Columna izquierda: estado y acciones ──────────────────── */}
      <View style={[s.panel, { paddingLeft: m.e(10) + bordes.left }]}>
        <Text style={s.bodega} numberOfLines={1}>{nombreBodega ?? "Sin bodega"}</Text>
        <Text style={s.fecha}>{fecha}</Text>

        {resumen ? (
          <View style={s.estado}>
            <Linea s={s} etiqueta="Partidas" valor={String(resumen.total)} />
            <Linea s={s} etiqueta="Contadas" valor={String(resumen.contadas)} />
            <Linea s={s} etiqueta="Faltan" valor={String(resumen.pendientesDeContar)} />
            <Linea s={s} etiqueta="Sin enviar" valor={String(resumen.pendientesDeEnviar)}
                   alerta={resumen.pendientesDeEnviar > 0} />
          </View>
        ) : (
          <Text style={s.ayuda}>No hay toma bajada en este aparato.</Text>
        )}

        <View style={s.acciones}>
          {opciones.tomaFisica.crear && (
            <Boton s={s} texto="Crear toma" tono="claro"
                   cargando={ocupado === "crear"} onPress={crear} />
          )}
          <Boton s={s} texto="Bajar" tono="claro"
                 cargando={ocupado === "bajar"} onPress={bajar} />
          {opciones.tomaFisica.contar && (
            <Boton
              s={s}
              texto={resumen && resumen.pendientesDeEnviar > 0
                ? `Enviar (${resumen.pendientesDeEnviar})`
                : "Enviar"}
              tono={resumen && resumen.pendientesDeEnviar > 0 ? "fuerte" : "claro"}
              cargando={ocupado === "enviar"}
              onPress={enviar}
            />
          )}
        </View>

        {toma && (
          <Pressable onPress={descartar}>
            <Text style={s.descartar}>Descartar del teléfono</Text>
          </Pressable>
        )}
      </View>

      {/* ── Columna derecha: filtros y captura ────────────────────── */}
      <View style={[s.derecha, { paddingRight: bordes.right }]}>
        <View style={s.filtros}>
          <Pressable style={s.selector} onPress={() => setVerUbicaciones(true)}>
            <Text style={s.selectorTexto} numberOfLines={1}>{nombreUbic}</Text>
            <Text style={s.selectorFlecha}>▾</Text>
          </Pressable>

          <TextInput
            style={s.buscaPartida}
            value={busca}
            onChangeText={setBusca}
            placeholder="Partida"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            // Sin esto, en horizontal el teclado de Android abre un editor a
            // pantalla completa y tapa la lista que se está contando.
            disableFullscreenUI
          />

          <Pressable
            style={[s.chip, soloPendientes && s.chipActivo]}
            onPress={() => setSoloPendientes((v) => !v)}
          >
            <Text style={[s.chipTexto, soloPendientes && s.chipTextoActivo]}>Faltantes</Text>
          </Pressable>
        </View>

        {error && <Text style={s.error}>{error}</Text>}

        <FlatList
          data={visibles}
          keyExtractor={(f) => String(f.id)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={visibles.length === 0 ? s.centro : s.lista}
          ListEmptyComponent={
            <Text style={s.vacio}>
              {toma ? "Ninguna partida con esos filtros." : "Bajá la toma para empezar a contar."}
            </Text>
          }
          renderItem={({ item }) => {
            const valor = toma ? valorDe(toma, item) : null;
            const sinEnviar = toma ? toma.conteos[String(item.id)] !== undefined : false;
            return (
              <View style={[s.fila, sinEnviar && s.filaSinEnviar]}>
                <View style={s.filaTextos}>
                  <Text style={s.partida} numberOfLines={1}>{item.partida}</Text>
                  <Text style={s.ubicacion} numberOfLines={1}>
                    {item.ubicacion}{item.calidad ? ` · ${item.calidad}` : ""}
                  </Text>
                </View>
                <TextInput
                  style={[s.conteo, valor === null && s.conteoVacio]}
                  defaultValue={valor === null ? "" : String(valor)}
                  onEndEditing={(e) => digitar(item, e.nativeEvent.text)}
                  keyboardType="numeric"
                  placeholder="—"
                  placeholderTextColor="#cbd5e1"
                  textAlign="center"
                  selectTextOnFocus
                  editable={opciones.tomaFisica.contar}
                  disableFullscreenUI
                />
              </View>
            );
          }}
        />
      </View>

      {/* Filtro de ubicación en modal: con cincuenta carriles la lista no
          entra en el panel sin comerse el alto que necesita la captura. */}
      <Modal visible={verUbicaciones} animationType="slide" onRequestClose={() => setVerUbicaciones(false)}>
        <View style={s.modal}>
          <Text style={s.modalTitulo}>Ubicación</Text>
          <ListaOpciones
            m={m}
            opciones={ubicaciones}
            seleccionado={ubicSel}
            alElegir={(u) => { setUbicSel(u.id); setVerUbicaciones(false); }}
            encabezado={{
              texto: "Todas",
              activo: ubicSel == null,
              alTocar: () => { setUbicSel(null); setVerUbicaciones(false); },
            }}
            vacio="Bajá la toma para ver las ubicaciones."
          />
          <Pressable style={s.modalCerrar} onPress={() => setVerUbicaciones(false)}>
            <Text style={s.modalCerrarTexto}>Cerrar</Text>
          </Pressable>
        </View>
      </Modal>
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
    <Pressable
      style={[s.btn, tono === "fuerte" ? s.btnFuerte : s.btnClaro]}
      onPress={onPress}
      disabled={cargando}
    >
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
    bodega: { fontSize: m.e(18), fontWeight: "700", color: VERDE },
    fecha: { fontSize: m.e(13), color: "#64748b", marginBottom: m.e(8) },
    estado: { marginBottom: m.e(10) },
    linea: { flexDirection: "row", justifyContent: "space-between", paddingVertical: m.e(3) },
    lineaEtiqueta: { fontSize: m.e(14), color: "#64748b" },
    lineaValor: { fontSize: m.e(15), color: "#0f172a", fontWeight: "700" },
    lineaAlerta: { color: "#b45309" },
    ayuda: { fontSize: m.e(14), color: "#64748b", marginBottom: m.e(10) },
    acciones: { gap: m.e(6) },
    btn: { height: m.t(46), borderRadius: 8, alignItems: "center", justifyContent: "center" },
    btnClaro: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1" },
    btnFuerte: { backgroundColor: VERDE },
    btnTexto: { fontSize: m.e(16), fontWeight: "700", color: "#334155" },
    btnTextoFuerte: { color: "#fff" },
    descartar: { fontSize: m.e(13), color: "#b91c1c", marginTop: m.e(10), textAlign: "center" },
    derecha: { flex: 1 },
    filtros: {
      flexDirection: "row", gap: m.e(6), padding: m.e(8),
      borderBottomWidth: 1, borderBottomColor: "#e2e8f0", backgroundColor: "#fff",
    },
    selector: {
      flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      height: m.t(44), paddingHorizontal: m.e(12), borderRadius: 8,
      borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "#fff",
    },
    selectorTexto: { flexShrink: 1, fontSize: m.e(16), color: "#0f172a" },
    selectorFlecha: { fontSize: m.e(16), color: "#64748b", marginLeft: m.e(6) },
    buscaPartida: {
      width: m.e(140), height: m.t(44), borderWidth: 1, borderColor: "#cbd5e1",
      borderRadius: 8, paddingHorizontal: m.e(10), fontSize: m.e(16),
      backgroundColor: "#fff", color: "#0f172a",
    },
    chip: {
      height: m.t(44), justifyContent: "center", paddingHorizontal: m.e(14), borderRadius: 8,
      backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1",
    },
    chipActivo: { backgroundColor: VERDE, borderColor: VERDE },
    chipTexto: { fontSize: m.e(15), color: "#334155" },
    chipTextoActivo: { color: "#fff", fontWeight: "700" },
    error: { color: "#b91c1c", padding: m.e(10), fontSize: m.e(14) },
    lista: { padding: m.e(8), gap: m.e(6) },
    vacio: { color: "#64748b", fontSize: m.e(15), textAlign: "center" },
    fila: {
      flexDirection: "row", alignItems: "center", gap: m.e(10),
      backgroundColor: "#fff", padding: m.e(10), borderRadius: 10,
      borderWidth: 1, borderColor: "#e2e8f0",
    },
    // Franja al canto: lo digitado que todavía no salió del teléfono.
    filaSinEnviar: { borderLeftWidth: m.e(5), borderLeftColor: "#f59e0b" },
    filaTextos: { flex: 1 },
    partida: { fontSize: m.e(18), fontWeight: "700", color: "#0f172a" },
    ubicacion: { fontSize: m.e(13), color: "#64748b", marginTop: 2 },
    conteo: {
      width: m.e(96), height: m.t(48), borderWidth: 2, borderColor: VERDE, borderRadius: 8,
      fontSize: m.e(20), fontWeight: "700", color: "#0f172a", backgroundColor: "#fff",
    },
    // Vacío no es cero: se ve distinto de un conteo en 0.
    conteoVacio: { borderColor: "#cbd5e1", backgroundColor: "#f8fafc" },
    modal: { flex: 1, padding: m.e(12), backgroundColor: "#f8fafc" },
    modalTitulo: { fontSize: m.e(18), fontWeight: "700", color: "#0f172a", marginBottom: m.e(8) },
    modalCerrar: {
      height: m.t(50), borderRadius: 8, backgroundColor: "#f1f5f9",
      borderWidth: 1, borderColor: "#cbd5e1",
      alignItems: "center", justifyContent: "center", marginTop: m.e(8),
    },
    modalCerrarTexto: { fontSize: m.e(16), fontWeight: "700", color: "#334155" },
  });
}
