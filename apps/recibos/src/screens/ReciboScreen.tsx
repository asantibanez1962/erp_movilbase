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
import { useSesion } from "../lib/sesion";
import type {
  Bitacora,
  Calidad,
  Certificado,
  Finca,
  Nivel,
  Productor,
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
  const recibidorNombre = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);

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

  // Quién entrega
  const [productor, setProductor] = useState<Productor | null>(null);
  const [noRegistrado, setNoRegistrado] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cedula, setCedula] = useState("");

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
    "productor" | "finca" | "calidad" | "certificado" | null
  >(null);

  const [medida, setMedida] = useState<MedidaCapturada>({
    cantidadinicial: 0,
    cuartillosinicial: 0,
    granosbrocados: 0,
    verdes: 0,
    flotemaduro: 0,
    floteseco: 0,
  });

  const tipoCafe = bitacora.tipocafe ?? "";

  useEffect(() => {
    void (async () => {
      // ⚠️ LOS CATÁLOGOS VAN APARTE DEL NÚMERO, y no en un solo Promise.all: eso rechaza al
      // primer fallo, y cuando la numeración tiraba NINGÚN catálogo se asignaba. El
      // formulario aparecía sin productores ni calidades, y el síntoma —"no hay datos"—
      // mandaba a revisar el sync, que estaba perfecto. Un problema de numeración no puede
      // vaciar la pantalla entera.
      try {
        const [c, prods, cals, certs, nivs] = await Promise.all([
          catalogosDelCalculo(),
          database.get<Productor>("productores").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Calidad>("calidades").query(Q.sortBy("calidad", Q.asc)).fetch(),
          database.get<Certificado>("certificados").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Nivel>("niveles").query().fetch(),
        ]);
        setCat(c);
        setProductores(prods);
        setCalidades(cals);
        setCertificados(certs);
        setNiveles(nivs);
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

  const guardar = async () => {
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
      });

      // La impresión ESC/POS todavía no existe. El recibo queda con `impreso = 0`, que es
      // el campo de cierre de la colección: sin imprimir NO sincroniza. Se dice tal cual,
      // en vez de dar por impreso algo que no salió en papel.
      Alert.alert(
        "Recibo guardado, sin imprimir",
        "La impresión por Bluetooth es el paso siguiente. Un recibo sin imprimir no " +
          "sincroniza — queda esperando en el teléfono."
      );
      onListo();
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo guardar el recibo.");
      setGuardando(false);
    }
  };

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
      {/* Contexto del recibo: dónde, cuándo y en qué jornada. Sin esto, dos teléfonos
          trabajando recibidores distintos se ven exactamente igual. */}
      <View
        style={{
          paddingHorizontal: 14,
          paddingTop: 12,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 6,
        }}
      >
        <Chip texto={recibidorNombre ?? "—"} />
        <Chip texto={cosecha ?? "—"} />
        <Chip
          texto={`Jornada ${fmtFecha(bitacora.fecha)}${tipoCafe ? ` · ${tipoCafe}` : ""}`}
        />
      </View>

      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <Text
          style={{
            fontSize: 12,
            color: colores.textoTenue,
            fontWeight: "700",
            letterSpacing: 0.6,
          }}
        >
          NIVEL {nombreNivel(niveles, nivel).toUpperCase()}
        </Text>
        <Text
          style={{
            fontSize: 22,
            fontWeight: "700",
            color: colores.texto,
            letterSpacing: 0.5,
          }}
        >
          {numero ?? "—"}
        </Text>
      </View>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      {/* ── Quién entrega ────────────────────────────────────────────────── */}
      <Rotulo texto="Quién entrega" />
      <Campo
        etiqueta="Productor"
        valor={noRegistrado ? "PENDIENTE" : (productor?.nombre ?? "Elegir productor")}
        vacio={!hayProductor}
        onPress={() => setPicker("productor")}
      />

      {noRegistrado ? (
        <View
          style={{
            marginHorizontal: 14,
            marginTop: 10,
            padding: 14,
            borderRadius: 10,
            backgroundColor: "#fef2f2",
            borderLeftWidth: 3,
            borderLeftColor: colores.error,
            gap: 10,
          }}
        >
          <Text style={{ color: colores.error, fontWeight: "700", fontSize: 14 }}>
            No está en el padrón — se pide para el papel
          </Text>
          <Entrada
            etiqueta="Nombre completo"
            valor={nombre}
            onChange={setNombre}
            mayusculas
          />
          <Entrada
            etiqueta="Identificación"
            valor={cedula}
            onChange={setCedula}
            teclado="number-pad"
          />
          <Text style={{ color: colores.textoTenue, fontSize: 12 }}>
            Sin CLdd ni certificado — no hay padrón todavía. La oficina reasigna el recibo
            cuando la persona quede registrada en regla.
          </Text>
        </View>
      ) : null}

      {productor ? (
        <View
          style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, marginTop: 10 }}
        >
          <View style={{ flex: 1 }}>
            <Campo
              etiqueta="Finca"
              valor={fincas.find((f) => Number(f.id) === idFinca)?.nombre ?? "Sin finca"}
              vacio={idFinca == null}
              sinMargen
              onPress={() => setPicker("finca")}
            />
          </View>
          <View style={{ flex: 1 }}>
            {/* CLdd es de sólo lectura: es un atributo de la FINCA, no un dato del recibo.
                Digitarlo sería inventar algo del maestro. */}
            <Lectura
              etiqueta="CLdd"
              valor={cldd ? "Cumple" : "No"}
              nota={idFinca == null ? "sin finca" : "de la finca"}
            />
          </View>
        </View>
      ) : null}

      {productor ? (
        <Campo
          etiqueta="Certificado"
          nota={
            certificadosDelProductor.length > 0
              ? `${certificadosDelProductor.length} cuota${
                  certificadosDelProductor.length === 1 ? "" : "s"
                } — se puede cambiar o quitar`
              : "el productor no tiene cuota en esta cosecha"
          }
          valor={nombreCertificado ?? "Ninguno"}
          vacio={idCertificado == null}
          onPress={() => setPicker("certificado")}
        />
      ) : null}

      <View style={{ flexDirection: "row", gap: 10, paddingHorizontal: 14, marginTop: 10 }}>
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
          {/* El tipo de café es de la JORNADA, no del recibo: cambiarlo a mitad del día
              cambiaría el precio de unos recibos y no de otros. */}
          <Lectura etiqueta="Tipo de café" valor={tipoCafe || "—"} nota="de la jornada" />
        </View>
      </View>

      {/* ── Medida ───────────────────────────────────────────────────────── */}
      <Rotulo texto="Medida" />
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
      <Rotulo texto="Defectos" />
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
            marginTop: 18,
            borderRadius: 12,
            paddingHorizontal: 18,
            paddingVertical: 16,
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

      <View style={{ padding: 16, gap: 12 }}>
        <TouchableOpacity
          onPress={guardar}
          disabled={!listo || guardando}
          style={{
            backgroundColor: listo ? cliente.chrome : colores.borde,
            borderRadius: 10,
            minHeight: 54,
            alignItems: "center",
            justifyContent: "center",
            opacity: guardando ? 0.6 : 1,
          }}
        >
          <Text
            style={{
              color: listo ? "#f1f5f9" : colores.textoTenue,
              fontWeight: "700",
              fontSize: 16,
            }}
          >
            {guardando ? "Guardando..." : "Imprimir recibo"}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onCancelar}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colores.textoTenue, fontSize: 14 }}>Cancelar</Text>
        </TouchableOpacity>
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

const entero = (t: string) => Math.max(0, Number.parseInt(t, 10) || 0);

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

function Rotulo({ texto }: Readonly<{ texto: string }>) {
  return <Text style={estilos.seccion}>{texto}</Text>;
}

/** Campo que abre un selector. Cajón con la etiqueta arriba, como el resto del form. */
function Campo({
  etiqueta,
  valor,
  nota,
  vacio,
  sinMargen,
  onPress,
}: Readonly<{
  etiqueta: string;
  valor: string;
  nota?: string;
  vacio?: boolean;
  sinMargen?: boolean;
  onPress: () => void;
}>) {
  return (
    <View style={{ paddingHorizontal: sinMargen ? 0 : 14, marginTop: 10 }}>
      <Text style={etiquetaEstilo}>
        {etiqueta}
        {nota ? (
          <Text style={{ color: colores.textoTenue, fontWeight: "400" }}>{`  ${nota}`}</Text>
        ) : null}
      </Text>
      <TouchableOpacity onPress={onPress} style={cajonEstilo}>
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
    <View style={{ marginTop: 10 }}>
      <Text style={etiquetaEstilo}>{etiqueta}</Text>
      <View style={[cajonEstilo, { backgroundColor: colores.fondo }]}>
        <Text style={{ fontSize: 16, color: colores.texto, fontWeight: "600" }}>
          {valor}
        </Text>
        {nota ? <Text style={{ color: colores.textoTenue, fontSize: 11 }}>{nota}</Text> : null}
      </View>
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
}: Readonly<{
  etiqueta: string;
  valor: string;
  onChange: (t: string) => void;
  teclado?: "number-pad" | "decimal-pad";
  mayusculas?: boolean;
  grande?: boolean;
}>) {
  return (
    <View style={{ marginTop: 2 }}>
      <Text style={etiquetaEstilo}>{etiqueta}</Text>
      <TextInput
        value={valor}
        onChangeText={onChange}
        keyboardType={teclado}
        autoCapitalize={mayusculas ? "characters" : "none"}
        selectTextOnFocus={teclado != null}
        style={[
          cajonEstilo,
          {
            fontSize: grande ? 24 : 16,
            fontWeight: grande ? "700" : "400",
            color: colores.texto,
          },
        ]}
      />
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
    <View style={{ marginTop: 2 }}>
      <Text style={etiquetaEstilo}>{etiqueta}</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        {opciones.map((o) => {
          const activo = o === valor;
          return (
            <TouchableOpacity
              key={o}
              onPress={() => onChange(o)}
              style={{
                flex: 1,
                minHeight: 50,
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
        alignItems: "flex-end",
        gap: 10,
        paddingHorizontal: 14,
        marginTop: 10,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={etiquetaEstilo}>{etiqueta}</Text>
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
          style={[cajonEstilo, { fontSize: 17, color: colores.texto }]}
        />
      </View>
      <View
        style={{
          minWidth: 96,
          minHeight: 48,
          borderRadius: 8,
          backgroundColor: colores.fondo,
          borderWidth: 1,
          borderColor: colores.borde,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 8,
        }}
      >
        <Text style={{ fontSize: 10, color: colores.textoTenue, letterSpacing: 0.4 }}>
          CASTIGO
        </Text>
        <Text style={{ fontSize: 15, fontWeight: "700", color: colores.advertencia }}>
          {castigo ?? "—"}
        </Text>
      </View>
    </View>
  );
}

const etiquetaEstilo = {
  fontSize: 12.5,
  color: colores.textoTenue,
  fontWeight: "600" as const,
  marginBottom: 4,
};

const cajonEstilo = {
  backgroundColor: colores.superficie,
  borderWidth: 1,
  borderColor: colores.borde,
  borderRadius: 8,
  paddingHorizontal: 12,
  minHeight: 48,
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
};
