import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Q } from "@nozbe/watermelondb";
import type { Catalogos, ResultadoCalculo } from "@erp/recibos-calc";
import { cliente } from "../branding";
import { database } from "../lib/db";
import {
  calcular,
  catalogosDelCalculo,
  crearRecibo,
  defaultsDeProductor,
  idSocioGenerico,
  nivelDelRecibidor,
  precioDe,
  proximoNumero,
  type MedidaCapturada,
} from "../lib/recibo";
import type {
  Bitacora,
  Calidad,
  Certificado,
  Finca,
  Nivel,
  Productor,
  TipoCafe,
} from "../db/models";
import { PickerModal, type OpcionPicker } from "./Picker";
import { colores, estilos, fmtCajuelas, fmtFecha } from "./estilos";

/**
 * El recibo: a quién se le recibe, cuánto, con qué defectos, y cuánto queda.
 *
 * El cálculo corre EN VIVO mientras se captura. No es un lujo: el recibidor discute la
 * medida con el productor que está enfrente, y ver el total moverse al corregir un dato es
 * lo que permite cerrar ese acuerdo antes de imprimir. Después de impreso, el papel ya se
 * fue con la persona.
 *
 * ⚠️ VERDES Y LOS DOS FLOTES SON PORCENTAJES, no conteos: `castigos_cosecha` los compara
 * contra un `topeaceptado` y les aplica un `pctcastigo`, así que llevan decimales. Sólo
 * `granosbrocados` es un conteo entero — la broca sale de una matriz de granos × cantidad.
 * Capturar un porcentaje como entero da un castigo distinto sin que nada avise.
 *
 * ⚠️ EL PRECIO Y EL VALOR SE CALCULAN PERO NO SE MUESTRAN. El recibo del móvil no es un
 * documento de pago: eso se resuelve en el servidor. Se guardan con la fila para que el
 * dato exista, y no aparecen ni en pantalla ni en el papel.
 *
 * Todo offline: catálogos locales y `@erp/recibos-calc`, el port verificado contra 38 487
 * recibos reales de la cosecha.
 */
export function ReciboScreen({
  bitacora,
  onListo,
  onCancelar,
}: Readonly<{ bitacora: Bitacora; onListo: () => void; onCancelar: () => void }>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [numero, setNumero] = useState<string | null>(null);
  const [nivel, setNivel] = useState<number | null>(null);
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [productores, setProductores] = useState<Productor[]>([]);
  const [calidades, setCalidades] = useState<Calidad[]>([]);
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);
  const [tiposCafe, setTiposCafe] = useState<TipoCafe[]>([]);

  // Quién entrega
  const [productor, setProductor] = useState<Productor | null>(null);
  const [noRegistrado, setNoRegistrado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cedula, setCedula] = useState("");
  /** El bloque del no registrado se colapsa una vez completo: son dos campos que sólo se
   *  llenan una vez y dejan la pantalla sin espacio para lo que falta capturar. */
  const [editandoPersona, setEditandoPersona] = useState(true);
  const [observaciones, setObservaciones] = useState("");

  // Lo que se deriva del productor
  const [fincas, setFincas] = useState<Finca[]>([]);
  const [idFinca, setIdFinca] = useState<number | null>(null);
  const [cldd, setCldd] = useState(0);
  const [idCertificado, setIdCertificado] = useState<number | null>(null);
  const [certificadosDelProductor, setCertificadosDelProductor] = useState<number[]>([]);

  // ⚠️ Maduro por defecto, y no es una preferencia: son 38 537 de los 38 550 recibos de la
  // cosecha. Dejarlo sin elegir cobra tres toques por algo que casi nunca cambia, en una
  // pantalla que se usa decenas de veces al día.
  const [calidad, setCalidad] = useState<string | null>("M");
  const [picker, setPicker] = useState<
    "productor" | "finca" | "calidad" | "certificado" | "tipocafe" | null
  >(null);

  const [medida, setMedida] = useState<MedidaCapturada>({
    cantidadinicial: 0,
    cuartillosinicial: 0,
    granosbrocados: 0,
    verdes: 0,
    flotemaduro: 0,
    floteseco: 0,
  });

  // Arranca con el de la jornada y se puede cambiar: la jornada dice qué se está
  // recibiendo hoy, pero un recibo puntual puede ser de otro tipo. Entra al criterio del
  // precio, así que no es una etiqueta.
  const [tipoCafe, setTipoCafe] = useState<string>(bitacora.tipocafe ?? "");

  useEffect(() => {
    void (async () => {
      // ⚠️ LOS CATÁLOGOS VAN APARTE DEL NÚMERO, y no en un solo Promise.all: eso rechaza al
      // primer fallo, y cuando la numeración tiraba NINGÚN catálogo se asignaba. El
      // formulario aparecía sin productores ni calidades, y el síntoma —"no hay datos"—
      // mandaba a revisar el sync, que estaba perfecto. Un problema de numeración no puede
      // vaciar la pantalla entera.
      try {
        const [c, prods, cals, certs, nivs, tcs] = await Promise.all([
          catalogosDelCalculo(),
          database.get<Productor>("productores").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Calidad>("calidades").query(Q.sortBy("calidad", Q.asc)).fetch(),
          database.get<Certificado>("certificados").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Nivel>("niveles").query().fetch(),
          database.get<TipoCafe>("tipos_cafe").query().fetch(),
        ]);
        setCat(c);
        setProductores(prods);
        setCalidades(cals);
        setCertificados(certs);
        setNiveles(nivs);
        setTiposCafe(tcs);
      } catch (e) {
        setError((e as Error)?.message ?? "No se pudieron leer los catálogos.");
      }

      try {
        const nv = await nivelDelRecibidor();
        setNivel(nv);
        if (nv == null) {
          setError(
            "Este recibidor no tiene nivel asignado para la cosecha. Sin eso no se " +
              "pueden calcular los castigos — hay que asignarlo desde el web."
          );
        }
      } catch (e) {
        setError((e as Error)?.message ?? "No se pudo resolver el nivel.");
      }

      try {
        setNumero(await proximoNumero());
      } catch (e) {
        setError((e as Error)?.message ?? "No se pudo asignar el número.");
      }

      setCargando(false);
    })();
  }, []);

  const elegirProductor = async (id: string) => {
    setPicker(null);
    if (id === "__generico__") {
      setNoRegistrado(true);
      setProductor(null);
      setFincas([]);
      setIdFinca(null);
      setCldd(0);
      setIdCertificado(null);
      setCertificadosDelProductor([]);
      setNombre("");
      setCedula("");
      setEditandoPersona(true);
      return;
    }

    const p = productores.find((x) => x.id === id) ?? null;
    setNoRegistrado(false);
    setProductor(p);
    setNombre(p?.nombre ?? "");
    setCedula(p?.cedula ?? "");

    if (!p) return;
    const idSocio = Number(p.id);
    const [d, fs] = await Promise.all([
      defaultsDeProductor(idSocio),
      database.get<Finca>("fincas").query(Q.where("id_socio", idSocio)).fetch(),
    ]);
    setFincas(fs);
    setIdFinca(d.idFinca);
    setCldd(d.cldd);
    setIdCertificado(d.idCertificado);
    setCertificadosDelProductor(d.certificados);
  };

  const calculo: ResultadoCalculo | null = useMemo(() => {
    if (cat == null || nivel == null) return null;
    try {
      return calcular(medida, nivel, cat);
    } catch {
      return null;
    }
  }, [cat, nivel, medida]);

  // El precio se resuelve en silencio. No se muestra —el recibo del móvil no es un
  // documento de pago— pero se guarda con la fila, junto con `valor = cantidad × precio`,
  // que es la misma fórmula del servidor.
  const [precio, setPrecio] = useState<{
    idreprecio: number;
    monto: number;
    moneda: number;
    flete: number;
  } | null>(null);

  useEffect(() => {
    if (!calidad || !tipoCafe) return;
    void (async () => {
      const p = await precioDe({
        tipoCafe,
        calidad,
        codigoProductor: productor?.codigo ?? "",
        tipoProductor: productor?.tipo?.trim() ?? "",
      });
      setPrecio(
        p
          ? { idreprecio: p.idreprecio, monto: p.monto, moneda: p.moneda, flete: p.flete }
          : null
      );
    })();
  }, [calidad, tipoCafe, productor]);

  const hayProductor = productor != null || noRegistrado;
  const listo =
    hayProductor &&
    calidad != null &&
    numero != null &&
    nivel != null &&
    calculo != null &&
    medida.cantidadinicial + medida.cuartillosinicial > 0 &&
    // Con genérico, nombre e identificación son OBLIGATORIOS: un recibo impreso sin nadie
    // identificado es peor que el estado actual, donde al menos se sabe que el dato quedó
    // anotado en el papel del recibidor.
    (!noRegistrado || (nombre.trim().length > 0 && cedula.trim().length > 0));

  /**
   * Las acciones viven en el HEADER, como en la pantalla legacy.
   *
   * No es sólo estética: el bloque de botones al pie ocupaba ~120px, y con él la pantalla
   * no cerraba sin scroll en un teléfono. Además quedan siempre a mano — no hay que
   * desplazarse hasta el final para grabar.
   */
  const menuAcciones = () => {
    const opciones: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];
    if (listo) {
      opciones.push({ text: "Imprimir recibo", onPress: () => void guardar({ imprimir: true }) });
      opciones.push({ text: "Guardar sin imprimir", onPress: () => void guardar({ imprimir: false }) });
    }
    opciones.push({
      text: "Descartar",
      style: "destructive",
      onPress: () =>
        Alert.alert("Descartar el recibo", "Se pierde lo capturado. ¿Seguro?", [
          { text: "No", style: "cancel" },
          { text: "Descartar", style: "destructive", onPress: onCancelar },
        ]),
    });
    opciones.push({ text: "Cancelar", style: "cancel" });

    Alert.alert(
      numero ?? "Recibo",
      listo ? undefined : "Faltan datos para poder grabar: productor, calidad y medida.",
      opciones
    );
  };

  const guardar = async (opts: { imprimir: boolean }) => {
    if (!listo || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await crearRecibo({
        bitacora,
        productor,
        nombre: nombre.trim(),
        cedula: cedula.trim(),
        idFinca,
        idCertificado,
        cldd,
        calidad: calidad!,
        tipoCafe,
        nivel: nivel!,
        medida,
        calculo: calculo!,
        precio,
        observaciones: observaciones.trim() || null,
      });

      // El recibo queda con `impreso = 0`, que es el campo de cierre de la colección: sin
      // imprimir NO sincroniza. Cuando entre ESC/POS, `opts.imprimir` dispara la impresión
      // y sólo entonces pasa a 1 — nunca se da por impreso algo que no salió en papel.
      Alert.alert(
        "Recibo guardado",
        opts.imprimir
          ? "La impresión por Bluetooth todavía no está implementada, así que quedó sin " +
              "imprimir. Un recibo sin imprimir no sincroniza: espera en el teléfono."
          : "Queda sin imprimir, esperando en el teléfono. No sincroniza hasta que salga " +
              "en papel."
      );
      onListo();
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo guardar el recibo.");
      setGuardando(false);
    }
  };

  // El botón de acciones vive en el header del Stack. Se re-registra cuando cambia algo
  // que el menú necesita leer: sin las dependencias, el closure guardaría el estado del
  // primer render y grabaría un recibo vacío.
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={menuAcciones}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 10 }}
        >
          <Text style={{ color: "#f1f5f9", fontSize: 22, fontWeight: "700" }}>⋮</Text>
        </TouchableOpacity>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, listo, guardando, numero, productor, noRegistrado, nombre, cedula,
      calidad, tipoCafe, medida, idFinca, idCertificado, cldd, observaciones]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={cliente.chrome} />
        <Text style={estilos.loadingText}>Preparando...</Text>
      </View>
    );
  }

  const opcionesProductor: OpcionPicker[] = [
    ...(idSocioGenerico() != null
      ? [
          {
            valor: "__generico__",
            titulo: "No está registrado",
            subtitulo: "Se le recibe igual; se piden nombre y cédula",
          },
        ]
      : []),
    // La cédula VA EN PANTALLA y no sólo en el índice de búsqueda: dos productores con el
    // mismo apellido en una zona chica es lo normal y el nombre solo no los distingue. Se
    // busca por nombre, código o cédula, porque la persona dice cualquiera de los tres.
    ...productores.map((p) => ({
      valor: p.id,
      titulo: p.nombre ?? p.codigo,
      subtitulo: [p.codigo, p.cedula].filter(Boolean).join("  ·  "),
      busqueda: `${p.nombre ?? ""} ${p.codigo} ${p.cedula ?? ""}`,
    })),
  ];

  const nombreCertificado =
    certificados.find((c) => c.idcertificado === idCertificado)?.nombre ?? null;

  return (
    <ScrollView
      style={estilos.root}
      contentContainerStyle={{ paddingBottom: 32 + insets.bottom }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Encabezado de UNA línea: fecha, nivel y número.
          Fuera el recibidor y la cosecha — el recibidor sabe dónde está, y sólo hay una
          cosecha a la vez, así que ninguno de los dos informa nada y los dos cobraban una
          línea de scroll. El tipo de café tampoco: ahora es un campo del recibo. */}
      <View
        style={{
          paddingHorizontal: 14,
          paddingTop: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <Chip texto={fmtFecha(bitacora.fecha)} />
        <Chip texto={nombreNivel(niveles, nivel)} />
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 20, fontWeight: "700", color: colores.texto }}>
          {numero ?? "—"}
        </Text>
        {/* Mientras diga SIN IMPRIMIR el recibo no sincroniza: `impreso` es el campo de
            cierre de la colección. */}
        <View
          style={{
            backgroundColor: colores.advertencia,
            borderRadius: 4,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Text
            style={{ fontSize: 8, fontWeight: "700", color: "#fff", lineHeight: 10 }}
          >
            {"SIN"}
            {"\n"}
            {"IMPRIMIR"}
          </Text>
        </View>
      </View>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      {/* CLDD acompaña al productor: no se edita —es un atributo de la finca— así que no
          necesita fila propia, y ahí libera una entera. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 8,
          paddingHorizontal: 14,
        }}
      >
        <View style={{ flex: 1 }}>
          <Campo
            etiqueta="Productor"
            valor={noRegistrado ? "PENDIENTE" : (productor?.nombre ?? "Elegir productor")}
            vacio={!hayProductor}
            sinMargen
            onPress={() => setPicker("productor")}
          />
        </View>
        <Casilla marcada={productor != null && cldd === 1} etiqueta="CLDD" />
      </View>

      {noRegistrado && !editandoPersona ? (
        // Colapsado: una línea con lo capturado y la puerta de vuelta. Ocupa 48px en vez
        // de los ~200 del bloque abierto, que era lo que empujaba el resto fuera de
        // pantalla justo cuando falta capturar la medida.
        <TouchableOpacity
          onPress={() => setEditandoPersona(true)}
          style={{
            marginHorizontal: 14,
            marginTop: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: FONDO_AVISO,
            borderLeftWidth: 3,
            borderLeftColor: colores.error,
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View style={{ flexShrink: 1 }}>
            <Text style={{ fontWeight: "700", color: colores.texto }} numberOfLines={1}>
              {nombre}
            </Text>
            <Text style={{ color: colores.textoTenue, fontSize: 12 }}>
              {cedula} · no está en el padrón
            </Text>
          </View>
          <Text style={{ color: colores.error, fontWeight: "600", fontSize: 13 }}>
            Editar
          </Text>
        </TouchableOpacity>
      ) : null}

      {noRegistrado && editandoPersona ? (
        <View
          style={{
            marginHorizontal: 14,
            marginTop: 12,
            padding: 12,
            borderRadius: 10,
            backgroundColor: FONDO_AVISO,
            borderLeftWidth: 3,
            borderLeftColor: colores.error,
            gap: 4,
          }}
        >
          <Text style={{ color: colores.error, fontWeight: "700", fontSize: 13 }}>
            No está en el padrón — se pide para el papel
          </Text>
          <Entrada
            etiqueta="Nombre completo"
            valor={nombre}
            onChange={setNombre}
            mayusculas
            fondoEtiqueta={FONDO_AVISO}
          />
          <Entrada
            etiqueta="Identificación"
            valor={cedula}
            onChange={setCedula}
            teclado="number-pad"
            fondoEtiqueta={FONDO_AVISO}
          />
          <TouchableOpacity
            onPress={() => setEditandoPersona(false)}
            // Los dos son OBLIGATORIOS: un recibo impreso sin nadie identificado es peor
            // que el estado actual, donde al menos el dato queda en el papel del
            // recibidor. Sin ellos tampoco se puede guardar (ver `listo`).
            disabled={nombre.trim().length === 0 || cedula.trim().length === 0}
            style={{
              marginTop: 8,
              minHeight: 42,
              borderRadius: 8,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor:
                nombre.trim() && cedula.trim() ? colores.error : colores.borde,
            }}
          >
            <Text
              style={{
                color: nombre.trim() && cedula.trim() ? "#fff" : colores.textoTenue,
                fontWeight: "700",
                fontSize: 14,
              }}
            >
              Listo
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Finca y certificado SIEMPRE ocupan su lugar, aunque todavía no haya productor.
          Antes aparecían al elegirlo y el formulario CRECÍA justo en el peor momento: lo
          que se estaba por tocar se corría de sitio. Un formulario de altura fija se
          aprende con el pulgar; uno que salta, no. */}
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <Campo
            etiqueta="Finca"
            valor={
              productor
                ? (fincas.find((f) => Number(f.id) === idFinca)?.nombre ?? "Sin finca")
                : "—"
            }
            vacio={idFinca == null}
            sinMargen
            onPress={() => productor && setPicker("finca")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Campo
            etiqueta="Certificado"
            nota={
              productor && certificadosDelProductor.length === 0 ? "sin cuota" : undefined
            }
            valor={productor ? (nombreCertificado ?? "Ninguno") : "—"}
            vacio={idCertificado == null}
            sinMargen
            onPress={() => productor && setPicker("certificado")}
          />
        </View>
      </View>

      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <Campo
            etiqueta="Calidad"
            valor={calidades.find((c) => c.calidad === calidad)?.nombre ?? "Elegir"}
            vacio={calidad == null}
            sinMargen
            onPress={() => setPicker("calidad")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Campo
            etiqueta="Tipo de café"
            valor={nombreTipoCafe(tiposCafe, tipoCafe)}
            vacio={!tipoCafe}
            sinMargen
            onPress={() => setPicker("tipocafe")}
          />
        </View>
      </View>

      {/* Sin rótulo de sección: "Cajuelas" y "Cuartillos" ya dicen que esto es la medida,
          y cada rótulo cuesta una línea de scroll durante la captura. */}
      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14 }}>
        <View style={{ flex: 1 }}>
          <Entrada
            etiqueta="Cajuelas"
            valor={String(medida.cantidadinicial)}
            onChange={(t) => setMedida((m) => ({ ...m, cantidadinicial: entero(t) }))}
            teclado="number-pad"
            grande
          />
        </View>
        <View style={{ flex: 1.3 }}>
          {/* Segmentado y no un stepper: son cuatro valores posibles y sólo cuatro. Un
              cuartillo es 0,25 de cajuela, así que en 4 ya es una cajuela más. */}
          <Segmentado
            etiqueta="Cuartillos"
            opciones={[0, 1, 2, 3]}
            valor={medida.cuartillosinicial}
            onChange={(v) => setMedida((m) => ({ ...m, cuartillosinicial: v }))}
          />
        </View>
      </View>

      {/* ── Defectos ─────────────────────────────────────────────────────── */}
      {/* Cada castigo AL LADO de su defecto y no todos juntos al final: cada línea es una
          relación causa→efecto, y es la conversación que el recibidor tiene con el
          productor enfrente — "por los verdes se le rebaja esto". */}
      <Defecto
        etiqueta="% Verdes"
        valor={medida.verdes}
        decimal
        castigo={
          calculo ? fmtCajuelas(calculo.rebajoverde, calculo.cuartillosrebajoverde) : null
        }
        onChange={(v) => setMedida((m) => ({ ...m, verdes: v }))}
      />
      <Defecto
        etiqueta="% Flote maduro"
        valor={medida.flotemaduro}
        decimal
        castigo={
          calculo ? fmtCajuelas(calculo.rebajoflote, calculo.cuartillosrebajoflote) : null
        }
        onChange={(v) => setMedida((m) => ({ ...m, flotemaduro: v }))}
      />
      <Defecto
        etiqueta="% Flote seco"
        valor={medida.floteseco}
        decimal
        castigo={
          calculo
            ? fmtCajuelas(calculo.rebajofloteseco, calculo.cuartillosrebajofloteseco)
            : null
        }
        onChange={(v) => setMedida((m) => ({ ...m, floteseco: v }))}
      />
      {/* Éste NO es porcentaje: la broca sale de una matriz de granos × cantidad bruta. */}
      <Defecto
        etiqueta="Granos brocados"
        valor={medida.granosbrocados}
        castigo={calculo ? fmtCajuelas(calculo.broca, calculo.cuartillosbroca) : null}
        onChange={(v) => setMedida((m) => ({ ...m, granosbrocados: v }))}
      />

      {/* ── Total ────────────────────────────────────────────────────────── */}
      {/* Sólo la cantidad. El valor se calcula y se guarda, pero no se muestra ni se
          imprime: el recibo del móvil no es un documento de pago. */}
      {calculo ? (
        <View
          style={{
            backgroundColor: cliente.chrome,
            marginHorizontal: 14,
            marginTop: 12,
            borderRadius: 10,
            paddingHorizontal: 16,
            paddingVertical: 12,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View>
            <Text
              style={{
                color: "#f1f5f9",
                fontSize: 14,
                fontWeight: "700",
                letterSpacing: 0.5,
              }}
            >
              TOTAL RECIBO
            </Text>
            <Text style={{ color: "#cbd5e1", fontSize: 12 }}>cajuelas · cuartillos</Text>
          </View>
          <Text style={{ color: "#f1f5f9", fontSize: 30, fontWeight: "700" }}>
            {fmtCajuelas(calculo.rcantidad, calculo.rcantidadcuartillos)}
          </Text>
        </View>
      ) : (
        <View style={estilos.vacio}>
          <Text style={estilos.vacioTexto}>
            {nivel == null
              ? "Falta el nivel del recibidor."
              : "Ingresá la medida para ver el total."}
          </Text>
        </View>
      )}

      <View style={{ paddingHorizontal: 14 }}>
        <Entrada etiqueta="Observaciones" valor={observaciones} onChange={setObservaciones} />
      </View>

      <PickerModal
        visible={picker === "productor"}
        titulo="Productor"
        opciones={opcionesProductor}
        onSeleccionar={(v) => void elegirProductor(v)}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "finca"}
        titulo="Finca"
        opciones={fincas.map((f) => ({ valor: f.id, titulo: f.nombre ?? f.id }))}
        onSeleccionar={(v) => {
          const f = fincas.find((x) => x.id === v);
          setIdFinca(f ? Number(f.id) : null);
          // El CLdd sigue a la finca elegida; no queda con el de la anterior.
          setCldd(f?.cldd ?? 0);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "calidad"}
        titulo="Calidad"
        opciones={calidades.map((c) => ({
          valor: c.calidad,
          titulo: c.nombre ?? c.calidad,
          subtitulo: c.calidad,
        }))}
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
          setTipoCafe(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "certificado"}
        titulo="Certificado"
        // Sólo los que el productor tiene por cuota ACTIVA, más la opción de quitarlo.
        // Ofrecer el catálogo entero invita a imputar el café a una cuota ajena, y eso no
        // da error: se descubre cuadrando certificados en la oficina.
        opciones={[
          { valor: "__ninguno__", titulo: "Sin certificado" },
          ...certificados
            .filter((c) => certificadosDelProductor.includes(c.idcertificado))
            .map((c) => ({
              valor: String(c.idcertificado),
              titulo: c.nombre ?? String(c.idcertificado),
            })),
        ]}
        onSeleccionar={(v) => {
          setIdCertificado(v === "__ninguno__" ? null : Number(v));
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
    </ScrollView>
  );
}

// ─── Piezas ─────────────────────────────────────────────────────────────────

/**
 * El nivel por su nombre —Inicios, Centro, Finales— y no por su número. Son los tramos de
 * la cosecha y el recibidor los conoce así; "Nivel 1" no dice nada e invita a confundirlo
 * con la calidad, que sí es un código.
 */
function nombreNivel(niveles: Nivel[], nivel: number | null): string {
  if (nivel == null) return "—";
  return niveles.find((n) => n.nivel === nivel)?.nombre ?? String(nivel);
}

/** Fondo del aviso del no registrado. Las etiquetas montadas sobre el borde lo necesitan
 *  para tapar el tramo de borde que cruzan. */
const FONDO_AVISO = "#fef2f2";

/** El nombre del tipo de café; el código sólo si el catálogo todavía no bajó. */
function nombreTipoCafe(tipos: TipoCafe[], codigo: string): string {
  if (!codigo) return "—";
  return tipos.find((t) => t.tipocafe.trim() === codigo.trim())?.nombre ?? codigo;
}

const entero = (t: string) => Math.max(0, Number.parseInt(t, 10) || 0);

/** Casilla de sólo lectura. Para un sí/no derivado, un cajón con texto es puro ruido. */
function Casilla({ marcada, etiqueta }: Readonly<{ marcada: boolean; etiqueta: string }>) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 4,
        minHeight: 42,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: marcada ? cliente.chrome : colores.borde,
          backgroundColor: marcada ? cliente.chrome : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {marcada ? (
          <Text style={{ color: "#fff", fontSize: 14, fontWeight: "900", lineHeight: 16 }}>
            ✓
          </Text>
        ) : null}
      </View>
      <Text style={{ fontSize: 13, fontWeight: "700", color: colores.textoTenue }}>
        {etiqueta}
      </Text>
    </View>
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

/** Campo que abre un selector. */
function Campo({
  etiqueta,
  valor,
  nota,
  vacio,
  sinMargen,
  fondoEtiqueta,
  onPress,
}: Readonly<{
  etiqueta: string;
  valor: string;
  nota?: string;
  vacio?: boolean;
  sinMargen?: boolean;
  fondoEtiqueta?: string;
  onPress: () => void;
}>) {
  return (
    <View style={{ paddingHorizontal: sinMargen ? 0 : 14, marginTop: 9 }}>
      <Marco etiqueta={etiqueta} nota={nota} fondoEtiqueta={fondoEtiqueta}>
        <TouchableOpacity onPress={onPress} style={interiorEstilo}>
          <Text
            style={{
              fontSize: 16,
              color: vacio ? colores.textoTenue : colores.texto,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {valor}
          </Text>
          <Text style={{ color: colores.textoTenue, fontSize: 16 }}>▾</Text>
        </TouchableOpacity>
      </Marco>
    </View>
  );
}

/** Dato derivado, no editable. Se muestra porque sale impreso. */
function Lectura({
  etiqueta,
  valor,
  nota,
}: Readonly<{ etiqueta: string; valor: string; nota?: string }>) {
  return (
    <View style={{ marginTop: 9 }}>
      <Marco etiqueta={etiqueta} nota={nota} tenue>
        <View style={interiorEstilo}>
          <Text style={{ fontSize: 16, color: colores.texto, fontWeight: "600" }}>
            {valor}
          </Text>
        </View>
      </Marco>
    </View>
  );
}

function Entrada({
  etiqueta,
  valor,
  onChange,
  teclado,
  mayusculas,
  grande,
  fondoEtiqueta,
}: Readonly<{
  etiqueta: string;
  valor: string;
  onChange: (t: string) => void;
  teclado?: "number-pad" | "decimal-pad";
  mayusculas?: boolean;
  grande?: boolean;
  fondoEtiqueta?: string;
}>) {
  return (
    <View style={{ marginTop: 9 }}>
      <Marco etiqueta={etiqueta} fondoEtiqueta={fondoEtiqueta}>
        <TextInput
          value={valor}
          onChangeText={onChange}
          keyboardType={teclado}
          autoCapitalize={mayusculas ? "characters" : "none"}
          selectTextOnFocus={teclado != null}
          style={[
            interiorEstilo,
            {
              fontSize: grande ? 24 : 16,
              fontWeight: grande ? "700" : "400",
              color: colores.texto,
            },
          ]}
        />
      </Marco>
    </View>
  );
}

/**
 * Cuartillos: cuatro valores y sólo cuatro. Botones grandes en vez de teclado — se toca de
 * pie, con una mano, y el teclado numérico de Android tapa media pantalla.
 */
function Segmentado({
  etiqueta,
  opciones,
  valor,
  onChange,
}: Readonly<{
  etiqueta: string;
  opciones: number[];
  valor: number;
  onChange: (v: number) => void;
}>) {
  return (
    <View style={{ marginTop: 9 }}>
      <Marco etiqueta={etiqueta} sinBorde>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {opciones.map((o) => {
            const activo = o === valor;
            return (
              <TouchableOpacity
                key={o}
                onPress={() => onChange(o)}
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
      </Marco>
    </View>
  );
}

/**
 * Un defecto y el castigo que produce, en la misma línea.
 *
 * ⚠️ `decimal` NO es cosmético: verdes y los dos flotes son PORCENTAJES; granos brocados
 * es un conteo. Capturar un porcentaje como entero da un castigo distinto sin aviso.
 *
 * El texto se guarda tal como se escribe mientras el campo está enfocado: reformateando
 * desde el número en cada tecla, escribir "4." se borraría solo justo en el punto.
 */
function Defecto({
  etiqueta,
  valor,
  castigo,
  decimal,
  onChange,
}: Readonly<{
  etiqueta: string;
  valor: number;
  castigo: string | null;
  decimal?: boolean;
  onChange: (v: number) => void;
}>) {
  const formatear = (n: number) => (decimal ? n.toFixed(2) : String(n));
  const [texto, setTexto] = useState<string | null>(null);

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 14,
        marginTop: 9,
      }}
    >
      <View style={{ flex: 1 }}>
        <Marco etiqueta={etiqueta}>
          <TextInput
            value={texto ?? formatear(valor)}
            onFocus={() => setTexto(formatear(valor))}
            onBlur={() => setTexto(null)}
            onChangeText={(t) => {
              setTexto(t);
              const n = decimal
                ? Number.parseFloat(t.replace(",", "."))
                : Number.parseInt(t, 10);
              onChange(Number.isFinite(n) && n > 0 ? n : 0);
            }}
            keyboardType={decimal ? "decimal-pad" : "number-pad"}
            selectTextOnFocus
            style={[interiorEstilo, { fontSize: 17, color: colores.texto }]}
          />
        </Marco>
      </View>
      {/* El castigo pegado a su defecto: cada línea es una relación causa→efecto, y es la
          conversación que el recibidor tiene con el productor enfrente. */}
      <View
        style={{
          minWidth: 88,
          height: 42,
          borderRadius: 8,
          backgroundColor: colores.fondo,
          borderWidth: 1,
          borderColor: colores.borde,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 8,
        }}
      >
        <Text style={{ fontSize: 9, color: colores.textoTenue, letterSpacing: 0.4 }}>
          CASTIGO
        </Text>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colores.advertencia }}>
          {castigo ?? "—"}
        </Text>
      </View>
    </View>
  );
}

/**
 * Marco con la etiqueta MONTADA SOBRE EL BORDE.
 *
 * Ahorra una línea de texto por campo, y con doce campos eso es la diferencia entre que la
 * pantalla entre en el teléfono o no. La etiqueta lleva el color de fondo detrás para
 * tapar el tramo de borde que cruza; por eso `fondoEtiqueta` es un parámetro y no una
 * constante: dentro del bloque rojo del no registrado el fondo es otro, y con el color
 * fijo se vería un recorte blanco.
 */
function Marco({
  etiqueta,
  nota,
  tenue,
  sinBorde,
  fondoEtiqueta,
  children,
}: Readonly<{
  etiqueta: string;
  nota?: string;
  tenue?: boolean;
  sinBorde?: boolean;
  fondoEtiqueta?: string;
  children: React.ReactNode;
}>) {
  return (
    <View style={{ position: "relative" }}>
      <View
        style={
          sinBorde
            ? undefined
            : {
                borderWidth: 1,
                borderColor: colores.borde,
                borderRadius: 8,
                backgroundColor: tenue ? colores.fondo : colores.superficie,
              }
        }
      >
        {children}
      </View>
      <Text
        style={{
          position: "absolute",
          top: -7,
          left: 10,
          paddingHorizontal: 4,
          backgroundColor: fondoEtiqueta ?? colores.fondo,
          fontSize: 11,
          fontWeight: "600",
          color: colores.textoTenue,
        }}
        numberOfLines={1}
      >
        {etiqueta}
        {nota ? (
          <Text style={{ fontWeight: "400", color: colores.textoTenue }}>{`  ${nota}`}</Text>
        ) : null}
      </Text>
    </View>
  );
}

/** Interior del marco: sin borde ni fondo propios — los pone el Marco. */
const interiorEstilo = {
  paddingHorizontal: 10,
  // 42 y no 48: la fila del legacy mide ~44 con su etiqueta al lado, y ahí está la
  // diferencia que hacía que la pantalla no cerrara sin scroll. Sigue por encima del
  // mínimo táctil cómodo y el número no se achica — se achica el aire, no el dato.
  minHeight: 42,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
};
