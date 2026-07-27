import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Solicitud } from "../db/models";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { describirFallos } from "@erp/shared-sync";
import { colores, estadoSolicitud, estilos, fmtFecha, fmtMoneda } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";
import { PickerModal } from "./componentes/Picker";
import { useOpcionesProductor } from "./componentes/opciones";
import {
  ChipLookup,
  ChipsFiltro,
  desdeDelRango,
  RANGOS,
  type RangoFecha,
} from "./componentes/Filtros";

/**
 * Solicitudes de crédito: las que bajaron del servidor y las creadas en el
 * teléfono, en una sola lista ordenada por fecha. Las locales llevan badge.
 *
 * Los tres filtros (productor, estado, rango de fechas) se combinan con AND. Con la
 * cosecha en curso un promotor junta decenas de solicitudes, y la que busca casi
 * siempre es "la de este productor" o "las que todavía están pendientes".
 */

/** Estados con su color, en el orden en que se busca. */
const ESTADOS: ReadonlyArray<{ valor: string; etiqueta: string; color?: string }> = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "0", etiqueta: "Pendientes", color: estadoSolicitud(0).color },
  { valor: "1", etiqueta: "Aprobadas", color: estadoSolicitud(1).color },
  { valor: "2", etiqueta: "Rechazadas", color: estadoSolicitud(2).color },
];

export function SolicitudesScreen({ navigation }: Readonly<{ navigation: any }>) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombres = useNombresProductor();
  const productores = useOpcionesProductor();

  const [filtroProductor, setFiltroProductor] = useState<string | null>(null);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroRango, setFiltroRango] = useState<RangoFecha>("todo");
  const [pickerAbierto, setPickerAbierto] = useState(false);

  useEffect(() => {
    const sub = database
      .get<Solicitud>("solicitudes")
      .query(Q.sortBy("fecha", Q.desc))
      .observe()
      .subscribe((rows) => {
        setSolicitudes(rows);
        setCargando(false);
      });
    return () => sub.unsubscribe();
  }, []);

  // Filtrado en memoria y no con Q.where: el cache del promotor son decenas o
  // cientos de solicitudes, y así los tres filtros se combinan sin rearmar la
  // query ni perder la suscripción que repinta cuando entra un sync.
  const visibles = useMemo(() => {
    const idSocio = filtroProductor != null ? Number(filtroProductor) : null;
    const estado = filtroEstado === "todos" ? null : Number(filtroEstado);
    const desde = desdeDelRango(filtroRango);

    return solicitudes.filter((s) => {
      if (idSocio != null && s.idSocio !== idSocio) return false;
      // `estado ?? 0`: las creadas en el teléfono todavía no tienen estado y son,
      // por definición, pendientes. Sin esto no aparecerían en "Pendientes", que es
      // justo donde el promotor las busca.
      if (estado != null && (s.estado ?? 0) !== estado) return false;
      if (desde != null && (s.fecha ?? 0) < desde) return false;
      return true;
    });
  }, [solicitudes, filtroProductor, filtroEstado, filtroRango]);

  const nombreProductorFiltro =
    filtroProductor != null
      ? (productores.find((p) => p.valor === filtroProductor)?.titulo ??
        `Socio #${filtroProductor}`)
      : null;

  const sincronizar = async () => {
    if (sincronizando) return;
    setSincronizando(true);
    setError(null);
    try {
      // Los fallos por colección vuelven en vez de tirar (el sync es resiliente): lo
      // que sí se pudo traer ya está aplicado.
      const fallos = await syncNow();
      setError(fallos.length > 0 ? describirFallos(fallos) : null);
    } catch (e) {
      setError((e as Error)?.message ?? "Error de sincronización");
    } finally {
      setSincronizando(false);
    }
  };

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
        <Text style={estilos.loadingText}>Cargando solicitudes...</Text>
      </View>
    );
  }

  const hayFiltro =
    filtroProductor != null || filtroEstado !== "todos" || filtroRango !== "todo";

  return (
    <View style={estilos.root}>
      <ChipLookup
        etiqueta="Filtrar por productor..."
        valor={nombreProductorFiltro}
        onAbrir={() => setPickerAbierto(true)}
        onLimpiar={() => setFiltroProductor(null)}
      />
      <ChipsFiltro
        opciones={ESTADOS}
        activa={filtroEstado}
        onElegir={setFiltroEstado}
      />
      <ChipsFiltro opciones={RANGOS} activa={filtroRango} onElegir={setFiltroRango} />

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}
      <FlatList
        data={visibles}
        keyExtractor={(s) => s.id}
        // extraData: los badges dependen de syncStatus/pushStatus, que cambian
        // sin que cambie la identidad de la fila. Sin esto la lista no repinta
        // después de un sync (mismo bug que se corrigió en recibos-cr).
        extraData={sincronizando}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={sincronizar} />
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              {hayFiltro
                ? `Ninguna solicitud coincide con el filtro${
                    solicitudes.length > 0 ? ` (hay ${solicitudes.length} en total).` : "."
                  }`
                : "No hay solicitudes. Deslizá hacia abajo para sincronizar."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const est = estadoSolicitud(item.estado);
          return (
            <TouchableOpacity
              style={estilos.fila}
              onPress={() =>
                navigation.navigate("SolicitudDetail", { solicitudId: item.id })
              }
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text style={[estilos.filaTitulo, { flex: 1 }]} numberOfLines={1}>
                  {item.idSocio != null
                    ? (nombres.get(item.idSocio) ?? `Socio #${item.idSocio}`)
                    : "(sin productor)"}
                </Text>
                {/* Verde/rojo/negro según pidió la operación. Va a la derecha del
                    nombre y no como badge abajo para que se lea de un barrido
                    vertical, sin tener que mirar cada fila entera. */}
                <Text
                  style={{ fontSize: 13, fontWeight: "700", color: est.color, marginLeft: 8 }}
                >
                  {est.texto}
                </Text>
              </View>
              <Text style={estilos.filaSubtitulo}>
                {fmtMoneda(item.total)} · {item.cosecha?.trim() || "sin cosecha"} ·{" "}
                {fmtFecha(item.fecha)}
              </Text>
              <EstadoPush fila={item} />
            </TouchableOpacity>
          );
        }}
      />

      <PickerModal
        visible={pickerAbierto}
        titulo="Filtrar por productor"
        opciones={productores}
        onSeleccionar={setFiltroProductor}
        onCerrar={() => setPickerAbierto(false)}
      />
    </View>
  );
}
