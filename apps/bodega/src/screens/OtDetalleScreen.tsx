import React from "react";
import {
  View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSesion } from "../lib/sesion";
import type { Props } from "../lib/rutas";
import { useMedidas, anchoPanel, Medidas } from "../lib/pantalla";
import { useOpciones } from "../lib/opciones";
import {
  CambioOt, COLOR_ESTADO, EST_EN_ESPERA, EST_INICIADA, EST_TERMINADA, ESTADOS,
  OtLocal, OtsLocales, conCambio, guardarOts, horaAhora, leerOts, vigente,
} from "../lib/otLocal";
import { VERDE } from "../branding";

/**
 * Ficha de una OT — la segunda pantalla del legacy.
 *
 * LOS BOTONES SON LA MAQUINA DE ESTADOS, no hay lista desplegable de estado.
 * El legacy tiene las dos cosas, y tenerlas juntas deja elegir "Terminada" sin
 * hora de fin ni avance: una fila que después nadie puede interpretar. Acá el
 * estado es consecuencia de lo que se tocó, y se muestra como resultado.
 *
 * EL AVANCE NO SE DIGITA. Son los botones de 25/50/75, y Finalizar pone 100.
 * Un campo libre invita a escribir 105, o 7, o a equivocarse de tecla con
 * guantes puestos.
 *
 * SE GUARDA AL TOCAR, NO AL SALIR. Cada acción escribe el archivo local: si el
 * aparato se apaga entre dos carriles, no se pierde nada. La pantalla no tiene
 * "Grabar" —el del legacy es para mandar al servidor, y eso acá es "Enviar" en
 * la lista, que es un paso aparte y a propósito.
 *
 * LAS HORAS LAS PONE EL TELEFONO al tocar, y el servidor las repone si llegan
 * vacías: la hora de arranque es el dato que hace medible la OT.
 */

export function OtDetalleScreen({ route, navigation }: Props<"OtDetalle">) {
  const { id } = route.params;
  const idBodega = useSesion((s) => s.idBodega);
  const puedeRegistrar = useOpciones((s) => s.opciones.ot.registrar);

  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const [datos, setDatos] = React.useState<OtsLocales | null>(null);
  const [cargando, setCargando] = React.useState(true);

  React.useEffect(() => {
    if (!idBodega) return;
    leerOts(idBodega).then((d) => { setDatos(d); setCargando(false); });
  }, [idBodega]);

  const ot: OtLocal | undefined = datos?.ots.find((o) => o.id === id);
  const v: CambioOt | null = datos && ot ? vigente(datos, ot) : null;

  async function aplicar(cambio: Partial<CambioOt>) {
    if (!datos || !ot || !v || !puedeRegistrar) return;
    const siguiente = conCambio(datos, ot.id, { ...v, ...cambio });
    setDatos(siguiente);
    await guardarOts(siguiente);
  }

  if (cargando) return <View style={s.centro}><ActivityIndicator size="large" color={VERDE} /></View>;

  if (!ot || !v) {
    return (
      <View style={s.centro}>
        <Text style={s.aviso}>
          Esta OT ya no está en el teléfono. Volvé y tocá “Bajar”.
        </Text>
      </View>
    );
  }

  const terminada = v.estado === EST_TERMINADA;

  return (
    <View style={s.pantalla}>
      {/* ── Columna izquierda: qué OT es ──────────────────────────── */}
      <View style={[s.panel, { paddingLeft: m.e(12) + bordes.left }]}>
        <ScrollView>
          <Text style={s.documento} numberOfLines={1} adjustsFontSizeToFit>{ot.documento}</Text>
          <View style={[s.pastilla, { backgroundColor: COLOR_ESTADO[v.estado] ?? "#94a3b8" }]}>
            <Text style={s.pastillaTexto}>{ESTADOS[v.estado] ?? v.estado}</Text>
          </View>

          <Dato s={s} etiqueta="Fecha" valor={ot.fecha} />
          <Dato s={s} etiqueta="Inventario" valor={ot.socio || "—"} />
          <Dato s={s} etiqueta="Hora inicio" valor={v.horaInicio ?? "—"} />
          <Dato s={s} etiqueta="Hora fin" valor={v.horaFin ?? "—"} />
          <Dato s={s} etiqueta="Avance" valor={`${v.avance}%`} />
        </ScrollView>
      </View>

      {/* ── Columna derecha: lo que se decide ─────────────────────── */}
      <ScrollView
        style={s.derecha}
        contentContainerStyle={[s.contenido, { paddingRight: m.e(10) + bordes.right }]}
        keyboardShouldPersistTaps="handled"
      >
        {!puedeRegistrar && (
          <Text style={s.aviso}>Solo lectura: no tiene permiso para registrar producción.</Text>
        )}

        <View style={s.botonera}>
          <Accion
            s={s} texto="Iniciar" color="#3f8f2e"
            activo={v.estado === EST_INICIADA}
            habilitado={puedeRegistrar && !terminada}
            onPress={() => void aplicar({
              estado: EST_INICIADA,
              horaInicio: v.horaInicio ?? horaAhora(),
            })}
          />
          <Accion
            s={s} texto="Detener" color="#2563eb"
            activo={v.estado === EST_EN_ESPERA}
            // Detener sin haber iniciado no significa nada, y dejaría una OT en
            // espera sin hora de arranque.
            habilitado={puedeRegistrar && !terminada && v.horaInicio != null}
            onPress={() => void aplicar({ estado: EST_EN_ESPERA })}
          />
          <Accion
            s={s} texto="Finalizar" color="#334155"
            activo={terminada}
            habilitado={puedeRegistrar && !terminada}
            onPress={() => void aplicar({
              estado: EST_TERMINADA,
              avance: 100,
              horaInicio: v.horaInicio ?? horaAhora(),
              horaFin: v.horaFin ?? horaAhora(),
            })}
          />
        </View>

        <Text style={s.titulo}>% Avance</Text>
        <View style={s.avances}>
          {[25, 50, 75].map((p) => (
            <Pressable
              key={p}
              style={[
                s.circulo,
                v.avance === p && s.circuloActivo,
                (!puedeRegistrar || terminada) && s.circuloApagado,
              ]}
              disabled={!puedeRegistrar || terminada}
              onPress={() => void aplicar({
                avance: p,
                // Marcar avance implica que arrancó: si nadie tocó Iniciar, se
                // asume acá en vez de dejar una OT con 50% y sin empezar.
                estado: v.estado === EST_INICIADA || v.estado === EST_EN_ESPERA
                  ? v.estado : EST_INICIADA,
                horaInicio: v.horaInicio ?? horaAhora(),
              })}
            >
              <Text style={[s.circuloTexto, v.avance === p && s.circuloTextoActivo]}>{p}%</Text>
            </Pressable>
          ))}
          {/* No se toca —lo pone Finalizar— pero tampoco puede verse mas
              encendido que los que si se tocan: se apaga con los demas. */}
          <View style={[
            s.circulo,
            terminada && s.circuloActivo,
            !terminada && s.circuloApagado,
          ]}>
            <Text style={[s.circuloTexto, terminada && s.circuloTextoActivo]}>100%</Text>
          </View>
        </View>
        {terminada && (
          <Text style={s.nota}>
            Terminada. Para corregirla hay que hacerlo desde el sistema.
          </Text>
        )}

        <Text style={s.titulo}>Observaciones</Text>
        <TextInput
          style={s.notas}
          defaultValue={v.notas}
          onEndEditing={(e) => void aplicar({ notas: e.nativeEvent.text })}
          multiline
          editable={puedeRegistrar}
          placeholder="Lo que haya que anotar de esta OT"
          placeholderTextColor="#94a3b8"
          disableFullscreenUI
        />

        <Pressable style={s.volver} onPress={() => navigation.goBack()}>
          <Text style={s.volverTexto}>Volver a la lista</Text>
        </Pressable>
        <Text style={s.nota}>
          Lo marcado queda en el teléfono. Sale recién al tocar “Enviar” en la lista.
        </Text>
      </ScrollView>
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

function Accion(
  { s, texto, color, activo, habilitado, onPress }:
  { s: Estilos; texto: string; color: string; activo: boolean; habilitado: boolean; onPress: () => void },
) {
  return (
    <Pressable
      style={[
        s.accion,
        { backgroundColor: activo ? color : "#fff", borderColor: color },
        !habilitado && s.accionApagada,
      ]}
      onPress={onPress}
      disabled={!habilitado}
    >
      <Text style={[s.accionTexto, { color: activo ? "#fff" : color }]}>{texto}</Text>
    </Pressable>
  );
}

type Estilos = ReturnType<typeof crearEstilos>;

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    pantalla: { flex: 1, flexDirection: "row", backgroundColor: "#f8fafc" },
    centro: { flex: 1, alignItems: "center", justifyContent: "center", padding: m.e(24) },
    panel: {
      width: anchoPanel(m), backgroundColor: "#fff",
      paddingVertical: m.e(12), paddingRight: m.e(12),
      borderRightWidth: 1, borderRightColor: "#e2e8f0",
    },
    documento: { fontSize: m.e(26), fontWeight: "700", color: "#0f172a" },
    pastilla: {
      alignSelf: "flex-start", paddingHorizontal: m.e(10), paddingVertical: m.e(4),
      borderRadius: 999, marginTop: m.e(4), marginBottom: m.e(8),
    },
    pastillaTexto: { fontSize: m.e(13), color: "#fff", fontWeight: "700" },
    dato: { flexDirection: "row", justifyContent: "space-between", gap: m.e(8), paddingVertical: m.e(4) },
    datoEtiqueta: { fontSize: m.e(14), color: "#64748b" },
    datoValor: { flexShrink: 1, fontSize: m.e(15), color: "#0f172a", fontWeight: "600", textAlign: "right" },
    derecha: { flex: 1 },
    contenido: { padding: m.e(12) },
    aviso: { fontSize: m.e(14), color: "#92400e", marginBottom: m.e(8) },
    botonera: { flexDirection: "row", gap: m.e(8) },
    accion: {
      flex: 1, minHeight: m.t(56), borderRadius: 10, borderWidth: 2,
      alignItems: "center", justifyContent: "center",
    },
    accionApagada: { opacity: 0.4 },
    accionTexto: { fontSize: m.e(17), fontWeight: "700" },
    titulo: { fontSize: m.e(14), color: "#64748b", marginTop: m.e(14), marginBottom: m.e(6) },
    avances: { flexDirection: "row", gap: m.e(10), alignItems: "center" },
    circulo: {
      width: m.t(64), height: m.t(64), borderRadius: 999,
      borderWidth: 2, borderColor: "#cbd5e1", backgroundColor: "#fff",
      alignItems: "center", justifyContent: "center",
    },
    circuloActivo: { backgroundColor: VERDE, borderColor: VERDE },
    circuloApagado: { opacity: 0.4 },
    circuloTexto: { fontSize: m.e(15), fontWeight: "700", color: "#334155" },
    circuloTextoActivo: { color: "#fff" },
    notas: {
      minHeight: m.t(80), borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8,
      padding: m.e(10), fontSize: m.e(16), backgroundColor: "#fff", color: "#0f172a",
      textAlignVertical: "top",
    },
    volver: {
      height: m.t(50), borderRadius: 8, backgroundColor: "#f1f5f9",
      borderWidth: 1, borderColor: "#cbd5e1",
      alignItems: "center", justifyContent: "center", marginTop: m.e(14),
    },
    volverTexto: { fontSize: m.e(16), fontWeight: "700", color: "#334155" },
    nota: { fontSize: m.e(12), color: "#64748b", marginTop: m.e(6), textAlign: "center" },
  });
}
