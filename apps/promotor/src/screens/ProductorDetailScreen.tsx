import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import {
  Finca,
  Productor,
  ReciboCosecha,
  Solicitud,
  Visita,
} from "../db/models";
import { database } from "../lib/db";
import { colores, estilos, fmtFecha, fmtMoneda } from "./estilos";

/**
 * Ficha del productor: sus datos + fincas + solicitudes + visitas + los totales
 * de recibos por cosecha. Todo del cache local, sin red — es la pantalla que el
 * promotor abre parado en el cafetal.
 *
 * Lo único que se puede EDITAR acá es el contacto (teléfonos y email). El
 * servidor lo declara así en `UpdatableFieldsJson` (v1.80/RC/10) y ahí termina el
 * alcance: cualquier otro campo que se escribiera viajaría y el push lo
 * descartaría sin decir nada, que es la peor forma de no funcionar.
 */
export function ProductorDetailScreen({
  route,
  navigation,
}: Readonly<{ route: any; navigation: any }>) {
  const { productorId } = route.params as { productorId: string };

  const [productor, setProductor] = useState<Productor | null>(null);
  const [fincas, setFincas] = useState<Finca[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [cosechas, setCosechas] = useState<ReciboCosecha[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    // `observe()` y no `find()`: al guardar el contacto la fila cambia, y con una
    // lectura de una sola vez la pantalla seguiría mostrando lo viejo hasta salir
    // y volver a entrar — el usuario creería que no se guardó.
    const sub = database
      .get<Productor>("productores")
      .findAndObserve(productorId)
      .subscribe({
        next: (p) => {
          if (cancelado) return;
          setProductor(p);
          setCargando(false);
        },
        error: () => !cancelado && setCargando(false),
      });

    return () => {
      cancelado = true;
      sub.unsubscribe();
    };
  }, [productorId]);

  // Las listas hijas se cuelgan del IdSocio, que sólo conocemos después de
  // resolver el productor (su id local ES el IdSocio, pero como string).
  useEffect(() => {
    if (!productor) return;
    const idSocio = Number(productor.id);
    if (Number.isNaN(idSocio)) return;

    const subs = [
      database
        .get<Finca>("fincas")
        .query(Q.where("id_socio", idSocio))
        .observe()
        .subscribe(setFincas),
      database
        .get<Solicitud>("solicitudes")
        .query(Q.where("id_socio", idSocio), Q.sortBy("fecha", Q.desc))
        .observe()
        .subscribe(setSolicitudes),
      database
        .get<Visita>("visitas")
        .query(Q.where("id_socio", idSocio), Q.sortBy("fecha", Q.desc))
        .observe()
        .subscribe(setVisitas),
      // El servidor ya decide CUÁLES cosechas bajan (la elegida y las 3
      // anteriores). Acá sólo se ordena para mostrar: repetir el recorte del lado
      // del teléfono sería tener la regla en dos lugares y desincronizarla.
      database
        .get<ReciboCosecha>("recibos_cosecha")
        .query(Q.where("id_socio", idSocio), Q.sortBy("cosecha", Q.desc))
        .observe()
        .subscribe(setCosechas),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, [productor]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (!productor) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>
          El productor ya no está en el cache local.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={estilos.root}>
      <Text style={estilos.seccion}>Datos</Text>
      <Dato etiqueta="Nombre" valor={productor.displayName} />
      <Dato etiqueta="Código" valor={productor.codigo?.trim()} />
      <Dato etiqueta="Identificación" valor={productor.identificacion?.trim()} />

      <Contacto productor={productor} />

      <TouchableOpacity
        style={local.botonSecundario}
        onPress={() =>
          navigation.navigate("Adjuntos", {
            coleccion: "productores",
            registroLocalId: productor.id,
            titulo: `Fotos de ${productor.displayName}`,
          })
        }
      >
        <Text style={local.botonSecundarioTexto}>Fotos del productor</Text>
      </TouchableOpacity>

      <Recibos cosechas={cosechas} />

      <Text style={estilos.seccion}>Fincas ({fincas.length})</Text>
      {fincas.length === 0 ? (
        <Vacio texto="Sin fincas registradas." />
      ) : (
        fincas.map((f) => (
          <View key={f.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>{f.displayName}</Text>
            <Text style={estilos.filaSubtitulo}>
              {[
                f.ubicacion?.trim(),
                f.area != null ? `${f.area} ha` : null,
                f.altitud != null ? `${f.altitud} msnm` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "sin detalle"}
            </Text>
          </View>
        ))
      )}

      <Text style={estilos.seccion}>Solicitudes ({solicitudes.length})</Text>
      {solicitudes.length === 0 ? (
        <Vacio texto="Sin solicitudes de crédito." />
      ) : (
        solicitudes.map((s) => (
          <View key={s.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>
              {fmtMoneda(s.total)} · {s.cosecha?.trim() || "sin cosecha"}
            </Text>
            <Text style={estilos.filaSubtitulo}>{fmtFecha(s.fecha)}</Text>
          </View>
        ))
      )}

      <Text style={estilos.seccion}>Visitas ({visitas.length})</Text>
      {visitas.length === 0 ? (
        <Vacio texto="Sin visitas registradas." />
      ) : (
        visitas.map((v) => (
          <View key={v.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>{fmtFecha(v.fecha)}</Text>
            <Text style={estilos.filaSubtitulo} numberOfLines={2}>
              {v.observaciones?.trim() || "sin observaciones"}
            </Text>
          </View>
        ))
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

/**
 * Teléfonos y email, editables en el lugar.
 *
 * Se guarda en la base LOCAL y el sync lo sube después. No se intenta mandar al
 * servidor en el momento a propósito: el promotor corrige un teléfono parado en
 * una finca sin señal, y una pantalla que exige conexión para guardar un dato que
 * ya escribió es una pantalla que pierde el dato.
 *
 * Al escribir, WMDB marca la fila como `updated` y pasa a contar como pendiente
 * (ver ESCRIBIBLES en lib/sync.ts) — así el promotor ve en el drawer que le queda
 * algo por enviar.
 */
function Contacto({ productor }: Readonly<{ productor: Productor }>) {
  const [editando, setEditando] = useState(false);
  const [telefonos, setTelefonos] = useState("");
  const [email, setEmail] = useState("");
  const [guardando, setGuardando] = useState(false);

  const abrir = () => {
    setTelefonos(productor.telefonos?.trim() ?? "");
    setEmail(productor.email?.trim() ?? "");
    setEditando(true);
  };

  const guardar = async () => {
    const tel = telefonos.trim();
    const mail = email.trim();

    // `telefonos` es varchar(50) en ge_Socio y el tipo no se cambió. Se avisa acá,
    // mientras la persona lo está viendo: si se dejara pasar, el push lo
    // rechazaría después y el motivo llegaría lejos del lugar donde se escribió.
    if (tel.length > 50) {
      Alert.alert(
        "Teléfonos muy largos",
        `El campo admite 50 caracteres y escribiste ${tel.length}. Dejá los que hagan falta.`
      );
      return;
    }
    if (mail.length > 100) {
      Alert.alert("Email muy largo", "El campo admite 100 caracteres.");
      return;
    }
    // Validación deliberadamente floja: alcanza con que parezca un correo. Un
    // regex estricto rechaza direcciones válidas raras, y acá el costo de un falso
    // rechazo (el promotor no puede guardar lo que le dictaron) es mayor que el de
    // un dato imperfecto, que alguien corrige después.
    if (mail && !/^\S+@\S+\.\S+$/.test(mail)) {
      Alert.alert("Email", "Eso no parece un correo. Revisalo o dejalo vacío.");
      return;
    }

    setGuardando(true);
    try {
      await database.write(async () => {
        await productor.update((p) => {
          p.telefonos = tel || null;
          p.email = mail || null;
        });
      });
      setEditando(false);
    } catch (e) {
      Alert.alert("No se pudo guardar", (e as Error)?.message ?? "Error desconocido");
    } finally {
      setGuardando(false);
    }
  };

  if (!editando) {
    return (
      <>
        <Dato etiqueta="Teléfonos" valor={productor.telefonos?.trim()} />
        <Dato etiqueta="Email" valor={productor.email?.trim()} />
        <TouchableOpacity style={local.botonSecundario} onPress={abrir}>
          <Text style={local.botonSecundarioTexto}>Corregir contacto</Text>
        </TouchableOpacity>
      </>
    );
  }

  return (
    <View style={local.editor}>
      <Text style={local.etiqueta}>Teléfonos</Text>
      <TextInput
        style={local.input}
        value={telefonos}
        onChangeText={setTelefonos}
        keyboardType="phone-pad"
        editable={!guardando}
        placeholder="8888-8888"
        placeholderTextColor={colores.textoTenue}
        maxLength={50}
      />

      <Text style={local.etiqueta}>Email</Text>
      <TextInput
        style={local.input}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!guardando}
        placeholder="correo@ejemplo.com"
        placeholderTextColor={colores.textoTenue}
        maxLength={100}
      />

      <View style={local.acciones}>
        <TouchableOpacity
          style={[local.boton, local.botonPlano]}
          onPress={() => setEditando(false)}
          disabled={guardando}
        >
          <Text style={local.botonPlanoTexto}>Cancelar</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[local.boton, guardando && { opacity: 0.5 }]}
          onPress={guardar}
          disabled={guardando}
        >
          {guardando ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={local.botonTexto}>Guardar</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Totales de recibos por cosecha.
 *
 * Sólo aparecen las cosechas en las que el productor ENTREGÓ. No se rellenan las
 * otras con cero: un cero dicho por el sistema se lee como "no entregó", y acá no
 * podríamos distinguirlo de "esa cosecha no bajó todavía".
 */
function Recibos({ cosechas }: Readonly<{ cosechas: ReciboCosecha[] }>) {
  return (
    <>
      <Text style={estilos.seccion}>Recibos por cosecha</Text>
      {cosechas.length === 0 ? (
        <Vacio texto="Sin recibos en las últimas cosechas." />
      ) : (
        cosechas.map((c) => (
          <View key={c.id} style={estilos.detalleFila}>
            <Text style={estilos.detalleEtiqueta}>{c.cosecha?.trim()}</Text>
            <Text style={estilos.detalleValor}>
              {fmtCantidad(c.cantidad)}
              <Text style={estilos.filaSubtitulo}>
                {"  "}
                {c.recibos} recibo{c.recibos === 1 ? "" : "s"}
              </Text>
            </Text>
          </View>
        ))
      )}
    </>
  );
}

/** Miles con separador y dos decimales: son cantidades de café, no plata. */
function fmtCantidad(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function Dato({
  etiqueta,
  valor,
}: Readonly<{ etiqueta: string; valor?: string | null }>) {
  return (
    <View style={estilos.detalleFila}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.detalleValor}>{valor || "—"}</Text>
    </View>
  );
}

function Vacio({ texto }: Readonly<{ texto: string }>) {
  return (
    <View style={estilos.vacio}>
      <Text style={estilos.vacioTexto}>{texto}</Text>
    </View>
  );
}

const local = {
  editor: {
    backgroundColor: colores.superficie,
    padding: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colores.borde,
  },
  etiqueta: {
    fontSize: 13,
    fontWeight: "600" as const,
    color: colores.textoTenue,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: colores.fondo,
    color: colores.texto,
    borderWidth: 1,
    borderColor: colores.borde,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  acciones: { flexDirection: "row" as const, gap: 12, marginTop: 16 },
  boton: {
    flex: 1,
    backgroundColor: colores.primario,
    borderRadius: 8,
    minHeight: 48,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  botonTexto: { color: "#fff", fontSize: 16, fontWeight: "600" as const },
  botonPlano: { backgroundColor: "transparent", borderWidth: 1, borderColor: colores.borde },
  botonPlanoTexto: { color: colores.textoTenue, fontSize: 16 },
  botonSecundario: {
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colores.borde,
    backgroundColor: colores.superficie,
    borderRadius: 8,
    minHeight: 48,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  botonSecundarioTexto: { color: colores.primario, fontSize: 15, fontWeight: "600" as const },
};
