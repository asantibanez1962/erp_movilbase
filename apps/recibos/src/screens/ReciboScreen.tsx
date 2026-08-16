import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Q } from "@nozbe/watermelondb";
import type { Catalogos, ResultadoCalculo } from "@erp/recibos-calc";
import { cliente } from "../branding";
import { database } from "../lib/db";
import {
  actualizarRecibo,
  calcular,
  catalogosDelCalculo,
  crearRecibo,
  defaultsDeProductor,
  esGenerico,
  idSocioGenerico,
  marcarImpreso,
  nivelDelRecibidor,
  precioDe,
  proximoNumero,
  type MedidaCapturada,
} from "../lib/recibo";
import { imprimirRecibo } from "../lib/imprimir";
import { bitacorasAbiertas } from "../lib/bitacora";
import { defectosDeLaEmpresa, type CampoDefecto } from "../lib/defectos";
import type {
  Bitacora,
  Recibo,
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
  bitacora: bitacoraInicial,
  recibo,
  onListo,
  onCancelar,
}: Readonly<{
  /** Jornada preseleccionada. Si falta, se elige acá. */
  bitacora?: Bitacora;
  /**
   * Presente ⇒ se EDITA un recibo que todavía no se imprimió.
   *
   * Un recibo sin imprimir es trabajo en curso: no salió en papel ni subió al servidor,
   * así que corregirlo es lo correcto. Al imprimirse queda firme — la misma condición
   * que lo retiene en el teléfono es la que lo deja editar.
   */
  recibo?: Recibo;
  onListo: () => void;
  onCancelar: () => void;
}>) {
  const editando = recibo != null;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();

  /**
   * Dos columnas cuando el ancho alcanza; una cuando no.
   *
   * El corte es por ANCHO DISPONIBLE y no por "es tableta": el mismo umbral sirve para la
   * tableta acostada (~1000dp) y para un teléfono acostado (~740dp), que es donde el alto
   * escasea más y las dos columnas más ayudan. Preguntar por el tipo de equipo dejaría al
   * teléfono horizontal con el layout equivocado.
   *
   * 700dp: la tableta DE PIE mide ~600dp (10,4" a 2000×1200 ⇒ 600×1000dp) y se lee mejor
   * en una columna; acostada llega a ~1000 y entra el recibo entero sin scroll.
   */
  const { width } = useWindowDimensions();
  const dosColumnas = width >= 700;
  // En una sola columna se limita el ancho: estirar un formulario a lo largo de una
  // tableta deja los campos como bandas con el texto perdido a la izquierda.
  const anchoMaximo = dosColumnas ? undefined : 560;

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
  /** Jornadas abiertas del recibidor. Puede haber varias: hay clientes que separan el
   *  día por categoría de café. */
  const [abiertas, setAbiertas] = useState<Bitacora[]>([]);
  const [bitacora, setBitacora] = useState<Bitacora | null>(bitacoraInicial ?? null);

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
    "productor" | "finca" | "calidad" | "certificado" | "tipocafe" | "bitacora" | null
  >(null);

  /**
   * Los defectos de control de calidad. Van aparte de `medida` a propósito: `MedidaCapturada`
   * es lo que entra al CÁLCULO, y éstos no castigan — mezclarlos invitaría a que alguien los
   * pase al motor y cambie números ya validados contra la cosecha entera.
   */
  const [defectos, setDefectos] = useState<Array<{ campo: CampoDefecto; etiqueta: string }>>([]);
  /**
   * Los defectos de control de calidad ya capturados.
   *
   * ⚠️ SE INICIALIZAN DESDE EL RECIBO, no en vacío. Arrancaban en `{}` siempre, también
   * al abrir uno guardado: la pantalla mostraba 0 en el campo y al grabar escribía ese 0
   * encima del valor real. Un recibo capturado con pintón, guardado sin imprimir y
   * reabierto para imprimirlo salía en papel y al servidor con el defecto BORRADO — y sin
   * ningún aviso, porque lo que se ve en pantalla es lo que se acaba de guardar.
   */
  const [extras, setExtras] = useState<Partial<Record<CampoDefecto, number>>>(() =>
    recibo
      ? { pinton: recibo.pinton, granopasa: recibo.granopasa, flotenegro: recibo.flotenegro }
      : {}
  );

  const [medida, setMedida] = useState<MedidaCapturada>({
    cantidadinicial: 0,
    cuartillosinicial: 0,
    granosbrocados: 0,
    verdes: 0,
    flotemaduro: 0,
    floteseco: 0,
  });

  // Arranca con el de la bitácora y se puede cambiar: la bitácora dice qué se está
  // recibiendo hoy, pero un recibo puntual puede ser de otro tipo. Entra al criterio del
  // precio, así que no es una etiqueta.
  const [tipoCafe, setTipoCafe] = useState<string>(
    recibo?.tipoCafe ?? bitacoraInicial?.tipocafe ?? ""
  );

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
          /**
           * ⚠️ SÓLO LOS ACTIVOS. El servidor rechaza con
           * `BUSINESS_RULE_VIOLATION — "El productor está inactivo"` todo recibo de uno
           * dado de baja, y para cuando eso pasa el papel ya está impreso y firmado: el
           * recibo no se puede corregir y no sube nunca.
           *
           * No es un caso raro. De los 12.852 productores, **6.347 están inactivos** —
           * casi la mitad de lo que ofrecía el selector era gente a la que no se le puede
           * recibir. Igual que con el precio: la app no debe ofrecer lo que el servidor
           * no va a aceptar.
           */
          database
            .get<Productor>("productores")
            .query(Q.where("estado", 1), Q.sortBy("nombre", Q.asc))
            .fetch(),
          database.get<Calidad>("calidades").query(Q.sortBy("calidad", Q.asc)).fetch(),
          database.get<Certificado>("certificados").query(Q.sortBy("nombre", Q.asc)).fetch(),
          database.get<Nivel>("niveles").query().fetch(),
          database.get<TipoCafe>("tipos_cafe").query().fetch(),
        ]);
        setCat(c);
        setDefectos([...(await defectosDeLaEmpresa())]);
        if (recibo) {
          setExtras({
            pinton: recibo.pinton,
            granopasa: recibo.granopasa,
            flotenegro: recibo.flotenegro,
          });
        }
        setProductores(prods);
        setCalidades(cals);
        setCertificados(certs);
        setNiveles(nivs);
        setTiposCafe(tcs);
      } catch (e) {
        setError((e as Error)?.message ?? "No se pudieron leer los catálogos.");
      }

      // La bitácora: si hay UNA sola abierta se asigna sola —es el caso normal— y si hay
      // varias se elige en el formulario. Es el único momento en que la app puede pedirle
      // al recibidor que decida algo que no puede deducir.
      try {
        const abiertas = await bitacorasAbiertas().fetch();
        setAbiertas(abiertas);
        if (recibo) {
          const suya = abiertas.find((b) => b.id === recibo.idBitacora);
          setBitacora(suya ?? null);
        } else if (bitacoraInicial == null && abiertas.length === 1) {
          setBitacora(abiertas[0]!);
        }
      } catch {
        // Sin bitácoras no se puede grabar, y `listo` ya lo impide. No vale romper la
        // pantalla entera por esto.
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

      // El número: el del recibo si se está editando —ya se asignó y es lo único que no
      // cambia— o el próximo de la secuencia si es nuevo.
      if (recibo) {
        setNumero(recibo.recibo);
      } else {
        try {
          setNumero(await proximoNumero());
        } catch (e) {
          setError((e as Error)?.message ?? "No se pudo asignar el número.");
        }
      }

      setCargando(false);
    })();
  }, []);

  /**
   * Carga el formulario con lo que ya tiene el recibo que se edita.
   *
   * Espera a que estén los productores: el formulario trabaja con el modelo del productor
   * —de él salen el código y el tipo, que entran al criterio del precio— y no sólo con su
   * id. Sin la espera, editar un recibo dejaría el productor en blanco y al grabar se
   * perdería.
   */
  useEffect(() => {
    if (!recibo || productores.length === 0) return;
    const p = productores.find((x) => Number(x.id) === recibo.idSocio) ?? null;
    const generico = esGenerico(recibo.idSocio);
    setProductor(generico ? null : p);
    setNoRegistrado(generico);
    setEditandoPersona(false);
    setNombre(recibo.nombre ?? "");
    setCedula(recibo.cedula ?? "");
    setIdFinca(recibo.idFinca);
    setCldd(recibo.cldd ?? 0);
    setIdCertificado(recibo.idCertificado);
    setCalidad(recibo.calidad);
    setObservaciones(recibo.observaciones ?? "");
    setMedida({
      cantidadinicial: recibo.cantidadinicial,
      cuartillosinicial: recibo.cuartillosinicial,
      granosbrocados: recibo.granosbrocados,
      verdes: recibo.verdes,
      flotemaduro: recibo.flotemaduro,
      floteseco: recibo.floteseco,
    });
    if (!generico && p) {
      void (async () => {
        const [d, fs] = await Promise.all([
          defaultsDeProductor(Number(p.id)),
          database.get<Finca>("fincas").query(Q.where("id_socio", Number(p.id))).fetch(),
        ]);
        setFincas(fs);
        setCertificadosDelProductor(d.certificados);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recibo, productores]);

  /**
   * EL TIPO DE CAFÉ SIGUE A LA JORNADA. Una sola regla, y por eso está acá.
   *
   * Antes se copiaba en tres lugares —la bitácora que llega por parámetro, la que se
   * autoasigna cuando hay una sola, y la que se elige en el selector— y al recibo creado
   * desde el menú Recibos no le llegaba por ninguno. Tres copias de una regla es tres
   * oportunidades de que un camino nuevo se olvide de ella, y el síntoma no es un error:
   * es un recibo sin precio que aparece cuadrando en la oficina.
   *
   * Mirando la bitácora VIGENTE da igual cómo se haya fijado.
   *
   * Al editar no se toca: manda lo que se guardó con el recibo.
   */
  useEffect(() => {
    if (recibo || !bitacora?.tipocafe) return;
    setTipoCafe(bitacora.tipocafe);
  }, [bitacora, recibo]);

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
    bitacora != null &&
    // Sin tipo de café no hay precio: buscarPrecio() filtra por él, así que el recibo
    // quedaría sin monto y eso se descubre en la oficina, no acá.
    tipoCafe.trim().length > 0 &&
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
      /**
       * ⚠️ SIN PRECIO NO SE IMPRIME, aunque el papel no muestre el monto.
       *
       * El servidor tiene una regla de negocio —`ReciboValidationHook`— que rechaza todo
       * recibo sin `idreprecio`: "No hay precio definido.". No es negociable desde acá.
       *
       * Y el recibo se congela al imprimirse. O sea que imprimir sin precio produce
       * exactamente el estado que esta app existe para evitar: **un papel firmado por el
       * productor que el sistema no va a aceptar nunca**, y que además traba el cierre de
       * la bitácora, porque cerrarla exige que todo haya subido.
       *
       * Por eso frena ACÁ y no en el sync: acá todavía no hay papel. Y el mensaje nombra
       * la combinación que falta, porque el arreglo es de la oficina y toma un minuto —
       * cargan el precio, el teléfono sincroniza y el recibo sale.
       *
       * En Altura hoy hay precio genérico sólo para (tipo 2, calidad M) en las zonas 0, 3
       * y 6, (tipo 1, M) en la 1 y (tipo 9, M) en la 5. Cualquier otra combinación cae acá.
       */
      if (!precio) {
        opciones.push({
          text: "Guardar sin imprimir",
          onPress: () => void guardar({ imprimir: false }),
        });
      } else {
        opciones.push({ text: "Imprimir recibo", onPress: () => void guardar({ imprimir: true }) });
        opciones.push({ text: "Guardar sin imprimir", onPress: () => void guardar({ imprimir: false }) });
      }
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

    let aviso: string | undefined;
    if (!listo) {
      aviso = "Faltan datos para poder grabar: bitácora, productor, calidad, tipo de café y medida.";
    } else if (!precio) {
      // Se nombra la combinación exacta: es lo que la oficina necesita para cargarlo, y
      // sin eso el recibidor sólo puede decir "no me deja", que no alcanza por teléfono.
      aviso =
        `NO HAY PRECIO para ${nombreTipoCafe(tiposCafe, tipoCafe)}, calidad ` +
        `${calidades.find((c) => c.calidad === calidad)?.nombre ?? "?"}, en esta cosecha.\n\n` +
        "El servidor rechaza los recibos sin precio, y una vez impreso el recibo ya no se " +
        "puede corregir.\n\n" +
        "Guardalo sin imprimir y pedí a la oficina que cargue el precio: al sincronizar, " +
        "abrís este mismo recibo y ya se puede imprimir. No hay que capturarlo de nuevo.";
    }

    Alert.alert(numero ?? "Recibo", aviso, opciones);
  };

  const guardar = async (opts: { imprimir: boolean }) => {
    if (!listo || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      const datos = {
        bitacora: bitacora!,
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
        extras,
      };
      let guardado: Recibo;
      if (recibo) {
        await actualizarRecibo(recibo, datos);
        guardado = recibo;
      } else {
        guardado = await crearRecibo(datos);
      }

      // Nace con `impreso = 0`, que es el campo de cierre de la colección: sin imprimir NO
      // sincroniza. Sólo la impresión lo suelta.
      if (!opts.imprimir) {
        Alert.alert(
          "Recibo guardado",
          "Queda sin imprimir, esperando en el teléfono. No sincroniza hasta que salga en papel."
        );
        onListo();
        return;
      }

      // Primero sale el papel, después se marca. Si el diálogo de impresión ni siquiera
      // abre, el recibo se queda en 0 y se puede reintentar; el trabajo capturado no se
      // pierde porque ya quedó guardado arriba.
      await imprimirRecibo(guardado);
      await marcarImpreso(guardado);
      onListo();
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo guardar el recibo.");
      setGuardando(false);
    }
  };

  /**
   * El botón de acciones vive en el header del Stack, y desde ahí se graba.
   *
   * ⚠️ EL MENÚ SE LEE POR REFERENCIA, NO SE VUELVE A REGISTRAR EN CADA CAMBIO.
   *
   * Antes el efecto se re-ejecutaba con una lista de dependencias que enumeraba a mano
   * cada estado que el menú necesita leer. Eso funciona hasta que alguien agrega un campo
   * y no lo agrega a la lista — y entonces el botón sigue llamando a un `guardar`
   * congelado, que escribe el valor viejo de ese campo.
   *
   * Pasó con los defectos de control de calidad: `extras` no estaba en la lista, así que
   * se capturaba un 5 en pintón, se veía un 5 en pantalla, y se grababa 0. El log lo dejó
   * en evidencia — `onChange pinton = 5` seguido de `al grabar {"pinton":0}` — pero desde
   * afuera parecía que el dato "no se guardaba", y costó tres intentos.
   *
   * Con la ref, el header siempre invoca el menú del último render. La lista de
   * dependencias deja de existir, y con ella la clase entera de defecto: no hay nada que
   * acordarse de agregar cuando entre el próximo campo.
   */
  const menuRef = useRef(menuAcciones);
  menuRef.current = menuAcciones;

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={() => menuRef.current()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 10 }}
        >
          <Text style={{ color: "#f1f5f9", fontSize: 22, fontWeight: "700" }}>⋮</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

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
      contentContainerStyle={{
        paddingBottom: 32 + insets.bottom,
        maxWidth: anchoMaximo,
        width: "100%",
        alignSelf: "center",
      }}
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

      {/* DOS COLUMNAS cuando el ancho alcanza: identificación a la izquierda, medida y
          defectos a la derecha, igual que la pantalla legacy de tableta. Así el recibo
          entero entra sin scroll, que es lo que importa cuando se captura de pie con el
          productor enfrente.

          Los dos bloques son EXACTAMENTE los mismos en las dos formas — sólo cambia cómo
          se acomodan. Duplicarlos habría hecho que cualquier campo nuevo tuviera que
          agregarse dos veces, y olvidarse de uno no da error: simplemente ese campo no
          existe en tabletas. */}
      {dosColumnas ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1 }}>
          {/* La bitácora a la que se cuelga el recibo. Con una sola abierta viene puesta y no
              hay nada que decidir; con varias —hay clientes que separan el día por categoría
              de café— el recibidor elige, y es lo único que la app no puede deducir. */}
          {abiertas.length > 1 || bitacora == null ? (
            <Campo
              etiqueta="Bitácora"
              valor={
                bitacora
                  ? `${fmtFecha(bitacora.fecha)}${
                      bitacora.tipocafe ? ` · ${nombreTipoCafe(tiposCafe, bitacora.tipocafe)}` : ""
                    }`
                  : "Elegir bitácora"
              }
              vacio={bitacora == null}
              onPress={() => setPicker("bitacora")}
            />
          ) : null}

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
          </View>
          <View style={{ flex: 1 }}>
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
          {/* Los de CONTROL DE CALIDAD, después de broca y sólo los que esta empresa
              declaró. No llevan castigo al lado porque no castigan: se registran y se
              imprimen. Ver `lib/defectos.ts`. */}
          {defectos.map((d) => (
            <Defecto
              key={d.campo}
              etiqueta={d.etiqueta}
              valor={extras[d.campo] ?? 0}
              // ⚠️ SON PORCENTAJES: sin `decimal` el input usa parseInt y teclado de
              // enteros, así que un 2,5 se guardaba como 2 y un 0,5 como 0 — o sea que el
              // dato "no se guardaba". Las columnas son decimal(18,3), igual que verdes y
              // los flotes, que sí lo tenían.
              decimal
              castigo={null}
              onChange={(v) => setExtras((x) => ({ ...x, [d.campo]: v }))}
            />
          ))}

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
          </View>
        </View>
      ) : (
        <>
      {/* La bitácora a la que se cuelga el recibo. Con una sola abierta viene puesta y no
          hay nada que decidir; con varias —hay clientes que separan el día por categoría
          de café— el recibidor elige, y es lo único que la app no puede deducir. */}
      {abiertas.length > 1 || bitacora == null ? (
        <Campo
          etiqueta="Bitácora"
          valor={
            bitacora
              ? `${fmtFecha(bitacora.fecha)}${
                  bitacora.tipocafe ? ` · ${nombreTipoCafe(tiposCafe, bitacora.tipocafe)}` : ""
                }`
              : "Elegir bitácora"
          }
          vacio={bitacora == null}
          onPress={() => setPicker("bitacora")}
        />
      ) : null}

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
      {/* ⚠️ ESTE BLOQUE ESTÁ DOS VECES en la pantalla, una por maquetado —dos columnas para
          tableta, una para teléfono— y hay que tocar LOS DOS. Se agregó sólo al de tableta
          la primera vez, y el resultado fue que el campo salía impreso pero no se podía
          capturar en vertical, que es como se usa el teléfono. */}
      {defectos.map((d) => (
        <Defecto
          key={d.campo}
          etiqueta={d.etiqueta}
          valor={extras[d.campo] ?? 0}
          // ⚠️ SON PORCENTAJES: ver la nota en el otro maquetado. Este bloque está DOS
          // veces —tableta y teléfono— y hay que tocar los dos.
          decimal
          castigo={null}
          onChange={(v) => setExtras((x) => ({ ...x, [d.campo]: v }))}
        />
      ))}

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
        </>
      )}

      <PickerModal
        visible={picker === "bitacora"}
        titulo="Bitácora"
        opciones={abiertas.map((b) => ({
          valor: b.id,
          titulo: fmtFecha(b.fecha),
          subtitulo: [nombreTipoCafe(tiposCafe, b.tipocafe ?? ""), b.transportista]
            .filter((x) => x && x !== "—")
            .join(" · "),
        }))}
        onSeleccionar={(v) => {
          const b = abiertas.find((x) => x.id === v) ?? null;
          setBitacora(b);
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
