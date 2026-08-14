import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Q } from "@nozbe/watermelondb";
import { cliente } from "../branding";
import { database } from "../lib/db";
import {
  actualizarRemedida,
  crearRemedida,
  partir,
  proximoNumero,
  rutasDe,
  type DatosRemedida,
  marcarRemedidaImpresa,
} from "../lib/remedida";
import { imprimirRemedida } from "../lib/imprimirRemedida";
import { useSesion } from "../lib/sesion";
import type {
  Calidad,
  Recibidor,
  Remedida,
  TipoCafe,
  Transportista,
} from "../db/models";
import { PickerModal, type OpcionPicker } from "./Picker";
import { SelectorMultiple } from "./SelectorMultiple";
import { colores, estilos, fmtFecha } from "./estilos";

/**
 * La remedida: el camión que llega de los recibidores.
 *
 * ⚠️ ACÁ NO HAY CÁLCULO, a diferencia del recibo. Los porcentajes se registran tal como
 * se miden y el servidor recompone los agregados del día. Por eso los defectos no llevan
 * un castigo al lado: no habría qué mostrar.
 *
 * De los 22 campos de la tabla se capturan 12. Los otros son de la oficina —tarifa,
 * monto, retención, asientos, aprobación— o están muertos: brocadas, chasparria,
 * densidad, flote negro, grano pasa y pintón están en CERO en las 2 012 remedidas de la
 * cosecha. Arrastrarlos a una pantalla que se usa de pie sería puro ruido.
 */
export function RemedidaScreen({
  remedida,
  onListo,
  onCancelar,
}: Readonly<{
  /** Presente ⇒ se EDITA una remedida que todavía no se imprimió. */
  remedida?: Remedida;
  onListo: () => void;
  onCancelar: () => void;
}>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { width } = useWindowDimensions();
  const dosColumnas = width >= 700;
  const cosecha = useSesion((s) => s.cosecha);
  /**
   * ⚠️ EL SIFÓN NO SE ELIGE: es el que el usuario tiene asignado, igual que el
   * recibidor en el recibo. En un sifón se hacen las dos cosas —recibos de quien
   * entrega en planta y remedidas de los camiones que llegan de los recibidores— y en
   * los dos casos el lugar lo fija la asignación, no la pantalla.
   *
   * De él sale además el prefijo del número, así que digitarlo sería poder emitir
   * documentos con el número de otro sitio.
   */
  const sifonSesion = useSesion((s) => s.recibidor);
  const sifonNombre = useSesion((s) => s.recibidorNombre ?? s.recibidor);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [calidades, setCalidades] = useState<Calidad[]>([]);
  const [tiposCafe, setTiposCafe] = useState<TipoCafe[]>([]);
  const [transportistas, setTransportistas] = useState<Transportista[]>([]);
  const [recibidores, setRecibidores] = useState<Recibidor[]>([]);

  const sifon = remedida?.sifon ?? sifonSesion ?? "";
  const [numero, setNumero] = useState<string | null>(remedida?.recibo ?? null);
  const [calidad, setCalidad] = useState<string | null>(remedida?.calidad ?? "M");
  const [tipocafe, setTipocafe] = useState<string | null>(remedida?.tipocafe ?? null);
  const [transportista, setTransportista] = useState<number | null>(
    remedida?.transportista ?? null
  );
  const [placa, setPlaca] = useState(remedida?.placa ?? "");
  const [angarilla, setAngarilla] = useState(String(remedida?.angarilla ?? 0));
  const [cajuelas, setCajuelas] = useState(
    String(remedida ? partir(remedida.cantidad).cajuelas : 0)
  );
  const [cuartillos, setCuartillos] = useState(
    remedida ? partir(remedida.cantidad).cuartillos : 0
  );
  const [verdes, setVerdes] = useState(remedida?.verdes ?? 0);
  const [flotemaduro, setFlotemaduro] = useState(remedida?.flotemaduro ?? 0);
  const [floteseco, setFloteseco] = useState(remedida?.floteseco ?? 0);
  const [brocados, setBrocados] = useState(String(remedida?.granosbrocados ?? 0));
  const [observaciones, setObservaciones] = useState(remedida?.observaciones ?? "");
  const [elegidos, setElegidos] = useState<string[]>([]);

  const [picker, setPicker] = useState<
    "calidad" | "tipocafe" | "transportista" | "recibidores" | null
  >(null);

  useEffect(() => {
    void (async () => {
      try {
        const [cals, tcs, trs, recs] = await Promise.all([
          database.get<Calidad>("calidades").query(Q.sortBy("calidad", Q.asc)).fetch(),
          database.get<TipoCafe>("tipos_cafe").query().fetch(),
          database.get<Transportista>("transportistas").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Recibidor>("recibidores").query(Q.sortBy("nombre", Q.asc)).fetch(),
        ]);
        setCalidades(cals);
        setTiposCafe(tcs);
        setTransportistas(trs);
        setRecibidores(recs);
      } catch (e) {
        setError((e as Error)?.message ?? "No se pudieron leer los catálogos.");
      }

      if (remedida) {
        const rutas = await rutasDe(remedida.id).fetch();
        setElegidos(rutas.map((r) => r.recibidor));
      }
      setCargando(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El número depende del SIFÓN, así que se recalcula al cambiarlo. Al editar no: el
  // número se asignó al crearla y es lo único que no cambia.
  useEffect(() => {
    if (remedida || !sifon.trim()) return;
    void proximoNumero(sifon)
      .then(setNumero)
      .catch((e: Error) => setError(e.message));
  }, [sifon, remedida]);

  // Sin sifón asignado no se puede emitir: el número sale de él.
  const sinSifon = !sifon.trim();

  const datos = (): DatosRemedida => ({
    sifon: sifon.trim(),
    calidad,
    tipocafe,
    transportista,
    placa: placa.trim() || null,
    angarilla: Number.parseInt(angarilla, 10) || 0,
    cajuelas: Number.parseInt(cajuelas, 10) || 0,
    cuartillos,
    verdes,
    flotemaduro,
    floteseco,
    granosbrocados: Number.parseInt(brocados, 10) || 0,
    observaciones: observaciones.trim() || null,
    recibidores: elegidos,
  });

  const listo =
    !sinSifon &&
    numero != null &&
    calidad != null &&
    // Sin recibidores la remedida no dice de dónde vino el café, que es justamente para
    // lo que sirve el documento.
    elegidos.length > 0 &&
    (Number.parseInt(cajuelas, 10) || 0) + cuartillos > 0;

  const guardar = async (opts: { imprimir: boolean }) => {
    if (!listo || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      let guardada: Remedida;
      if (remedida) {
        await actualizarRemedida(remedida, datos());
        guardada = remedida;
      } else {
        guardada = await crearRemedida(datos());
      }

      // Nace con `impreso = 0`, el campo de cierre de la colección: sin imprimir no
      // sincroniza. Sólo la impresión la suelta.
      if (!opts.imprimir) {
        Alert.alert(
          "Remedida guardada",
          "Queda SIN IMPRIMIR, esperando en el teléfono: no sincroniza hasta salir en papel."
        );
        onListo();
        return;
      }

      // Primero el papel, después la marca. Si el diálogo ni siquiera abre, la remedida
      // queda en cero y se reintenta; lo capturado no se pierde porque ya se guardó.
      await imprimirRemedida(guardada);
      await marcarRemedidaImpresa(guardada);
      onListo();
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo guardar.");
      setGuardando(false);
    }
  };

  const menu = () => {
    const opciones: Array<{
      text: string;
      style?: "cancel" | "destructive";
      onPress?: () => void;
    }> = [];
    if (listo) {
      opciones.push({
        text: "Imprimir remedida",
        onPress: () => void guardar({ imprimir: true }),
      });
      opciones.push({
        text: "Guardar sin imprimir",
        onPress: () => void guardar({ imprimir: false }),
      });
    }
    opciones.push({
      text: "Descartar",
      style: "destructive",
      onPress: () =>
        Alert.alert("Descartar la remedida", "Se pierde lo capturado. ¿Seguro?", [
          { text: "No", style: "cancel" },
          { text: "Descartar", style: "destructive", onPress: onCancelar },
        ]),
    });
    opciones.push({ text: "Cancelar", style: "cancel" });

    Alert.alert(
      numero ?? "Remedida",
      listo
        ? undefined
        : "Faltan datos: sifón, calidad, la medida y al menos un recibidor.",
      opciones
    );
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={menu} hitSlop={10} style={{ paddingHorizontal: 10 }}>
          <Text style={{ color: "#f1f5f9", fontSize: 22, fontWeight: "700" }}>⋮</Text>
        </TouchableOpacity>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, listo, guardando, numero, elegidos, sifon, calidad, cajuelas, cuartillos]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={cliente.chrome} />
        <Text style={estilos.loadingText}>Preparando...</Text>
      </View>
    );
  }

  const nombreDe = <T,>(lista: T[], coincide: (x: T) => boolean, nombre: (x: T) => string | null) => {
    const x = lista.find(coincide);
    return x ? (nombre(x) ?? "—") : "Elegir...";
  };

  const identificacion = (
    <>
      <Campo etiqueta="Calidad">
        <TouchableOpacity onPress={() => setPicker("calidad")} style={interior}>
          <Text style={{ fontSize: 16, color: colores.texto }}>
            {nombreDe(calidades, (c) => c.calidad === calidad, (c) => c.nombre)}
          </Text>
          <Text style={{ color: colores.textoTenue }}>▾</Text>
        </TouchableOpacity>
      </Campo>

      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <Campo etiqueta="Tipo de café" sinMargen>
            <TouchableOpacity onPress={() => setPicker("tipocafe")} style={interior}>
              <Text style={{ fontSize: 16, color: colores.texto }} numberOfLines={1}>
                {nombreDe(tiposCafe, (t) => t.tipocafe === tipocafe, (t) => t.nombre)}
              </Text>
              <Text style={{ color: colores.textoTenue }}>▾</Text>
            </TouchableOpacity>
          </Campo>
        </View>
        <View style={{ flex: 1 }}>
          <Campo etiqueta="Angarillas" sinMargen>
            <TextInput
              value={angarilla}
              onChangeText={setAngarilla}
              keyboardType="number-pad"
              selectTextOnFocus
              style={[interior, { fontSize: 17, color: colores.texto }]}
            />
          </Campo>
        </View>
      </View>

      <Campo etiqueta="Transportista">
        <TouchableOpacity onPress={() => setPicker("transportista")} style={interior}>
          <Text style={{ fontSize: 16, color: colores.texto, flexShrink: 1 }} numberOfLines={1}>
            {nombreDe(
              transportistas,
              (t) => Number(t.transportista) === transportista,
              (t) => t.nombre
            )}
          </Text>
          <Text style={{ color: colores.textoTenue }}>▾</Text>
        </TouchableOpacity>
      </Campo>

      <Campo etiqueta="Placa">
        <TextInput
          value={placa}
          onChangeText={setPlaca}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
          style={[interior, { fontSize: 16, color: colores.texto }]}
        />
      </Campo>

      {/* ── Recibidores ──────────────────────────────────────────────────────
          Como fichas y no en otra pantalla: se ve de un vistazo cuántos van y se quita
          uno sin navegar. Van de 1 a 17 por camión, con la mitad en uno o dos. */}
      <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 12.5, color: colores.textoTenue, fontWeight: "600" }}>
            Recibidores{elegidos.length > 0 ? ` (${elegidos.length})` : ""}
          </Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => setPicker("recibidores")} hitSlop={8}>
            <Text style={{ color: cliente.chrome, fontWeight: "700", fontSize: 13 }}>
              + Agregar
            </Text>
          </TouchableOpacity>
        </View>

        {elegidos.length === 0 ? (
          <Text style={{ color: colores.textoTenue, fontSize: 13, paddingVertical: 10 }}>
            De qué recibidores viene el camión.
          </Text>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 8 }}>
            {elegidos.map((codigo) => (
              <TouchableOpacity
                key={codigo}
                onPress={() => setElegidos((xs) => xs.filter((x) => x !== codigo))}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  backgroundColor: colores.superficie,
                  borderWidth: 1,
                  borderColor: colores.borde,
                  borderRadius: 16,
                  paddingLeft: 10,
                  paddingRight: 8,
                  paddingVertical: 6,
                }}
              >
                <Text style={{ fontSize: 13, color: colores.texto }}>
                  {recibidores.find((r) => r.recibidor.trim() === codigo)?.nombre ?? codigo}
                </Text>
                <Text style={{ color: colores.textoTenue, fontSize: 15 }}>✕</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </>
  );

  const medida = (
    <>
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <Campo etiqueta="Cajuelas" sinMargen>
            <TextInput
              value={cajuelas}
              onChangeText={setCajuelas}
              keyboardType="number-pad"
              selectTextOnFocus
              style={[interior, { fontSize: 24, fontWeight: "700", color: colores.texto }]}
            />
          </Campo>
        </View>
        <View style={{ flex: 1.3 }}>
          <Campo etiqueta="Cuartillos" sinBorde sinMargen>
            <View style={{ flexDirection: "row", gap: 6 }}>
              {[0, 1, 2, 3].map((o) => {
                const activo = o === cuartillos;
                return (
                  <TouchableOpacity
                    key={o}
                    onPress={() => setCuartillos(o)}
                    style={{
                      flex: 1,
                      minHeight: 42,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: activo ? cliente.chrome : colores.borde,
                      backgroundColor: activo ? cliente.chrome : colores.superficie,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 17,
                        fontWeight: "700",
                        color: activo ? "#f1f5f9" : colores.textoTenue,
                      }}
                    >
                      {o}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Campo>
        </View>
      </View>

      {/* Los defectos NO llevan castigo al lado: acá no hay cálculo — el servidor
          recompone los agregados del día. */}
      <Decimal etiqueta="% Verdes" valor={verdes} onChange={setVerdes} />
      <Decimal etiqueta="% Flote maduro" valor={flotemaduro} onChange={setFlotemaduro} />
      <Decimal etiqueta="% Flote seco" valor={floteseco} onChange={setFloteseco} />
      <Campo etiqueta="Granos brocados">
        <TextInput
          value={brocados}
          onChangeText={setBrocados}
          keyboardType="number-pad"
          selectTextOnFocus
          style={[interior, { fontSize: 17, color: colores.texto }]}
        />
      </Campo>

      <Campo etiqueta="Observaciones">
        <TextInput
          value={observaciones}
          onChangeText={setObservaciones}
          maxLength={200}
          style={[interior, { fontSize: 16, color: colores.texto }]}
        />
      </Campo>
    </>
  );

  return (
    <ScrollView
      style={estilos.root}
      contentContainerStyle={{
        paddingBottom: 32 + insets.bottom,
        maxWidth: dosColumnas ? undefined : 560,
        width: "100%",
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          paddingHorizontal: 14,
          paddingTop: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Chip texto={fmtFecha(remedida?.fecha ?? Date.now())} />
        <Chip texto={sifonNombre ?? "sin sifón"} />
        <Chip texto={cosecha ?? "—"} />
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: colores.texto }}>
          {numero ?? "—"}
        </Text>
      </View>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}
      {sinSifon ? (
        <Text style={estilos.error}>
          Tu usuario no tiene un sifón asignado. La remedida se hace EN un sifón, y de
          él sale el número del documento — hay que asignarlo desde el web.
        </Text>
      ) : null}

      {dosColumnas ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>{identificacion}</View>
          <View style={{ flex: 1 }}>{medida}</View>
        </View>
      ) : (
        <>
          {identificacion}
          {medida}
        </>
      )}

      <PickerModal
        visible={picker === "calidad"}
        titulo="Calidad"
        opciones={calidades.map((c) => ({ valor: c.calidad, titulo: c.nombre ?? c.calidad }))}
        onSeleccionar={(v) => {
          setCalidad(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "tipocafe"}
        titulo="Tipo de café"
        opciones={tiposCafe.map((t) => ({
          valor: t.tipocafe,
          titulo: t.nombre ?? t.tipocafe,
          subtitulo: t.tipocafe,
        }))}
        onSeleccionar={(v) => {
          setTipocafe(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "transportista"}
        titulo="Transportista"
        opciones={transportistas.map((t) => ({
          valor: t.transportista,
          titulo: t.nombre ?? t.transportista,
          subtitulo: t.transportista,
        }))}
        onSeleccionar={(v) => {
          setTransportista(Number(v));
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <SelectorMultiple
        visible={picker === "recibidores"}
        titulo="Recibidores del camión"
        // Sólo los de campo (tipo R): el sifón es DONDE se recibe, no de dónde viene
        // el camión, y ofrecerlo acá invita a marcarse a sí mismo.
        opciones={recibidores
          .filter((r) => (r.tipo ?? "").trim().toUpperCase() !== "S")
          .map((r) => ({
            valor: r.recibidor.trim(),
            titulo: r.nombre ?? r.recibidor,
            subtitulo: r.recibidor.trim(),
          }))}
        elegidos={elegidos}
        onListo={(v) => {
          setElegidos(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
    </ScrollView>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

const interior = {
  paddingHorizontal: 10,
  minHeight: 42,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
};

/** Marco con la etiqueta montada sobre el borde, igual que en el recibo. */
function Campo({
  etiqueta,
  sinBorde,
  sinMargen,
  children,
}: Readonly<{
  etiqueta: string;
  sinBorde?: boolean;
  sinMargen?: boolean;
  children: React.ReactNode;
}>) {
  return (
    <View
      style={{ paddingHorizontal: sinMargen ? 0 : 14, marginTop: 9, position: "relative" }}
    >
      <View
        style={
          sinBorde
            ? undefined
            : {
                borderWidth: 1,
                borderColor: colores.borde,
                borderRadius: 8,
                backgroundColor: colores.superficie,
              }
        }
      >
        {children}
      </View>
      <Text
        style={{
          position: "absolute",
          top: -7,
          left: sinMargen ? 10 : 24,
          paddingHorizontal: 4,
          backgroundColor: colores.fondo,
          fontSize: 11,
          fontWeight: "600",
          color: colores.textoTenue,
        }}
      >
        {etiqueta}
      </Text>
    </View>
  );
}

/**
 * Porcentaje con decimales.
 *
 * ⚠️ Los porcentajes NO son enteros: la columna es numeric(12,3) y el web captura 5,000.
 * Redondearlos acá cambiaría el dato sin que nada avise.
 */
function Decimal({
  etiqueta,
  valor,
  onChange,
}: Readonly<{ etiqueta: string; valor: number; onChange: (v: number) => void }>) {
  const [texto, setTexto] = useState<string | null>(null);
  return (
    <Campo etiqueta={etiqueta}>
      <TextInput
        value={texto ?? valor.toFixed(2)}
        onFocus={() => setTexto(valor.toFixed(2))}
        onBlur={() => setTexto(null)}
        onChangeText={(t) => {
          setTexto(t);
          const n = Number.parseFloat(t.replace(",", "."));
          onChange(Number.isFinite(n) && n > 0 ? n : 0);
        }}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={[interior, { fontSize: 17, color: colores.texto }]}
      />
    </Campo>
  );
}

function Chip({ texto }: Readonly<{ texto: string }>) {
  return (
    <View
      style={{
        backgroundColor: colores.superficie,
        borderWidth: 1,
        borderColor: colores.borde,
        borderRadius: 14,
        paddingHorizontal: 10,
        paddingVertical: 4,
      }}
    >
      <Text style={{ fontSize: 12, color: colores.textoTenue }}>{texto}</Text>
    </View>
  );
}
