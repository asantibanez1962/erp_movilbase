import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Entregador, Productor, Solicitud } from "../db/models";
import { database } from "../lib/db";
import { crearEntregador } from "../lib/crear";
import { syncNow } from "../lib/sync";
import { colores, estilos, fmtFecha, fmtMoneda } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";
import { PickerModal } from "./componentes/Picker";
import { useOpcionesProductor } from "./componentes/opciones";

/**
 * Detalle de una solicitud con sus entregadores.
 *
 * Los entregadores se buscan por `id_solicitud` = id LOCAL de esta solicitud,
 * que es el mismo valor tanto si la solicitud bajó del servidor como si nació
 * en el teléfono. Esa uniformidad es justamente lo que compra el esquema de
 * ClientUuid (ver db/schema.ts).
 */
export function SolicitudDetailScreen({ route }: Readonly<{ route: any }>) {
  const { solicitudId } = route.params as { solicitudId: string };

  const [solicitud, setSolicitud] = useState<Solicitud | null>(null);
  const [entregadores, setEntregadores] = useState<Entregador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pickerAbierto, setPickerAbierto] = useState(false);
  const nombres = useNombresProductor();
  const productores = useOpcionesProductor();

  useEffect(() => {
    let cancelado = false;
    database
      .get<Solicitud>("solicitudes")
      .find(solicitudId)
      .then((s) => {
        if (cancelado) return;
        setSolicitud(s);
        setCargando(false);
      })
      .catch(() => !cancelado && setCargando(false));

    const sub = database
      .get<Entregador>("entregadores")
      .query(Q.where("id_solicitud", solicitudId))
      .observe()
      .subscribe(setEntregadores);

    return () => {
      cancelado = true;
      sub.unsubscribe();
    };
  }, [solicitudId]);

  /**
   * El picker devuelve el id local del productor, que ES su IdSocio. De ahí
   * salen las dos cosas que guarda el entregador: idsocio (la relación real) y
   * rc_codigo (denormalizado para el legacy).
   *
   * El código se lee del record y no del subtítulo del picker porque rc_codigo y
   * codigo son columnas distintas de ge_Socio y difieren en cientos de socios
   * (ver v1.53/RC/06).
   */
  const agregarEntregador = async (productorLocalId: string) => {
    try {
      const productor = await database
        .get<Productor>("productores")
        .find(productorLocalId);

      const idSocio = Number(productor.id);
      if (Number.isNaN(idSocio)) throw new Error("Productor con id inválido.");

      const codigo = productor.rcCodigo?.trim();
      if (!codigo) {
        Alert.alert(
          "Productor sin código RC",
          `${productor.displayName} no tiene rc_codigo asignado, así que no puede figurar como entregador. Hay que cargarlo en el ERP.`
        );
        return;
      }

      await crearEntregador(solicitudId, idSocio, codigo);
      syncNow().catch((e) =>
        console.warn("sync tras agregar entregador", (e as Error)?.message)
      );
    } catch (e) {
      Alert.alert("No se pudo agregar", (e as Error)?.message ?? "Error desconocido");
    }
  };

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (!solicitud) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>
          La solicitud ya no está en el cache local.
        </Text>
      </View>
    );
  }

  const s = solicitud;

  return (
    <ScrollView style={estilos.root}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <EstadoPush fila={s} />
      </View>

      <Text style={estilos.seccion}>Encabezado</Text>
      <Dato
        etiqueta="Productor"
        valor={
          s.idSocio != null
            ? (nombres.get(s.idSocio) ?? `Socio #${s.idSocio}`)
            : null
        }
      />
      <Dato etiqueta="Código" valor={s.codigo?.trim()} />
      <Dato etiqueta="Fecha" valor={fmtFecha(s.fecha)} />
      <Dato etiqueta="Cosecha" valor={s.cosecha?.trim()} />
      <Dato etiqueta="Zona" valor={s.zona?.trim()} />

      <Text style={estilos.seccion}>Rubros</Text>
      <Dato etiqueta="Efectivo" valor={fmtMoneda(s.efectivo)} />
      <Dato etiqueta="Insumos" valor={fmtMoneda(s.insumos)} />
      <Dato etiqueta="Almácigo" valor={fmtMoneda(s.almacigo)} />
      <Dato etiqueta="Formalización" valor={fmtMoneda(s.formalizacion)} />
      <Dato etiqueta="Otros" valor={fmtMoneda(s.otros)} />
      <Dato etiqueta="Total" valor={fmtMoneda(s.total)} />
      <Dato etiqueta="Aprobado" valor={fmtMoneda(s.aprobado)} />

      <Text style={estilos.seccion}>Plan y estimados</Text>
      <Dato etiqueta="Plan de inversión" valor={s.planInversion?.trim()} />
      <Dato etiqueta="Motivo" valor={s.motivo?.trim()} />
      <Dato
        etiqueta="Entrega estimada"
        valor={s.entregaEstimada != null ? String(s.entregaEstimada) : null}
      />
      <Dato
        etiqueta="Prod. estimada"
        valor={s.prodEstimada != null ? String(s.prodEstimada) : null}
      />
      {/* Los dos siguientes los escribe el BE desde la visita de validación de
          crédito — acá son informativos, igual que en el form web. */}
      <Dato
        etiqueta="Prod. estimada promotor"
        valor={
          s.prodEstimadaPromotor != null ? String(s.prodEstimadaPromotor) : null
        }
      />
      <Dato
        etiqueta="Inspección de campo"
        valor={s.inspeccionCampo === 1 ? "Sí" : "No"}
      />

      <Text style={estilos.seccion}>Entregadores ({entregadores.length})</Text>
      {entregadores.length === 0 ? (
        <View style={estilos.vacio}>
          <Text style={estilos.vacioTexto}>Sin entregadores.</Text>
        </View>
      ) : (
        entregadores.map((e) => (
          <View key={e.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>
              {e.idSocio != null
                ? (nombres.get(e.idSocio) ?? `Socio #${e.idSocio}`)
                : (e.codigo?.trim() || "(sin productor)")}
            </Text>
            {/* El código sigue visible: es lo que el usuario reconoce del ERP
                y de los papeles del legacy. */}
            <Text style={estilos.filaSubtitulo}>
              {e.codigo?.trim() || "sin código"}
            </Text>
            <EstadoPush fila={e} />
          </View>
        ))
      )}

      <TouchableOpacity
        style={[estilos.fila, { alignItems: "center" }]}
        onPress={() => setPickerAbierto(true)}
      >
        <Text style={{ color: colores.primario, fontSize: 16, fontWeight: "700" }}>
          + Agregar entregador
        </Text>
      </TouchableOpacity>

      <View style={{ height: 32 }} />

      <PickerModal
        visible={pickerAbierto}
        titulo="Elegir entregador"
        opciones={productores}
        onSeleccionar={agregarEntregador}
        onCerrar={() => setPickerAbierto(false)}
      />
    </ScrollView>
  );
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
