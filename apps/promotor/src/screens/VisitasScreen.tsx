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
import { TipoVisita, Visita } from "../db/models";
import { database } from "../lib/db";
import { syncNow } from "../lib/sync";
import { describirFallos } from "@erp/shared-sync";
import { colores, estilos, fmtFecha } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";
import { PickerModal } from "./componentes/Picker";
import {
  useOpcionesProductor,
  useOpcionesTipoVisita,
} from "./componentes/opciones";
import {
  ChipLookup,
  ChipsFiltro,
  desdeDelRango,
  RANGOS,
  type RangoFecha,
} from "./componentes/Filtros";

/**
 * Visitas de campo, más recientes primero, con filtros por productor, tipo y rango
 * de fechas combinados con AND.
 *
 * El filtro de tipo importa más que en solicitudes: los tipos son 11 y responden
 * preguntas distintas ("¿ya hice la validación de crédito de este productor?" vs
 * "¿cuándo pasé por el recibidor?").
 */
export function VisitasScreen({ navigation }: Readonly<{ navigation: any }>) {
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [tipos, setTipos] = useState<Map<number, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nombres = useNombresProductor();
  const productores = useOpcionesProductor();
  const { opciones: opcionesTipo } = useOpcionesTipoVisita();

  const [filtroProductor, setFiltroProductor] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);
  const [filtroRango, setFiltroRango] = useState<RangoFecha>("todo");
  const [abierto, setAbierto] = useState<"productor" | "tipo" | null>(null);

  useEffect(() => {
    const subVisitas = database
      .get<Visita>("visitas")
      .query(Q.sortBy("fecha", Q.desc))
      .observe()
      .subscribe((rows) => {
        setVisitas(rows);
        setCargando(false);
      });

    const subTipos = database
      .get<TipoVisita>("tipos_visita")
      .query()
      .observe()
      .subscribe((rows) => {
        const mapa = new Map<number, string>();
        for (const t of rows) {
          const id = Number(t.id);
          if (!Number.isNaN(id)) mapa.set(id, t.nombre ?? `Tipo ${id}`);
        }
        setTipos(mapa);
      });

    return () => {
      subVisitas.unsubscribe();
      subTipos.unsubscribe();
    };
  }, []);

  const visibles = useMemo(() => {
    const idSocio = filtroProductor != null ? Number(filtroProductor) : null;
    const idTipo = filtroTipo != null ? Number(filtroTipo) : null;
    const desde = desdeDelRango(filtroRango);

    return visitas.filter((v) => {
      if (idSocio != null && v.idSocio !== idSocio) return false;
      if (idTipo != null && v.idTipoVisita !== idTipo) return false;
      if (desde != null && (v.fecha ?? 0) < desde) return false;
      return true;
    });
  }, [visitas, filtroProductor, filtroTipo, filtroRango]);

  const nombreProductorFiltro =
    filtroProductor != null
      ? (productores.find((p) => p.valor === filtroProductor)?.titulo ??
        `Socio #${filtroProductor}`)
      : null;
  const nombreTipoFiltro =
    filtroTipo != null ? (tipos.get(Number(filtroTipo)) ?? `Tipo ${filtroTipo}`) : null;

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
        <Text style={estilos.loadingText}>Cargando visitas...</Text>
      </View>
    );
  }

  const hayFiltro =
    filtroProductor != null || filtroTipo != null || filtroRango !== "todo";

  return (
    <View style={estilos.root}>
      <ChipLookup
        etiqueta="Filtrar por productor..."
        valor={nombreProductorFiltro}
        onAbrir={() => setAbierto("productor")}
        onLimpiar={() => setFiltroProductor(null)}
      />
      <ChipLookup
        etiqueta="Filtrar por tipo de visita..."
        valor={nombreTipoFiltro}
        onAbrir={() => setAbierto("tipo")}
        onLimpiar={() => setFiltroTipo(null)}
      />
      <ChipsFiltro opciones={RANGOS} activa={filtroRango} onElegir={setFiltroRango} />

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}
      <FlatList
        data={visibles}
        keyExtractor={(v) => v.id}
        extraData={sincronizando}
        refreshControl={
          <RefreshControl refreshing={sincronizando} onRefresh={sincronizar} />
        }
        ListEmptyComponent={
          <View style={estilos.vacio}>
            <Text style={estilos.vacioTexto}>
              {hayFiltro
                ? `Ninguna visita coincide con el filtro${
                    visitas.length > 0 ? ` (hay ${visitas.length} en total).` : "."
                  }`
                : "No hay visitas registradas. Deslizá hacia abajo para sincronizar."}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={estilos.fila}
            onPress={() => navigation.navigate("VisitaDetail", { visitaId: item.id })}
          >
            <Text style={estilos.filaTitulo}>
              {item.idSocio != null
                ? (nombres.get(item.idSocio) ?? `Socio #${item.idSocio}`)
                : (item.recibidor?.trim() || "(sin productor)")}
            </Text>
            <Text style={estilos.filaSubtitulo}>
              {tipos.get(item.idTipoVisita) ?? `Tipo ${item.idTipoVisita}`} ·{" "}
              {fmtFecha(item.fecha)}
              {item.tieneGps ? " · 📍" : ""}
            </Text>
            {item.observaciones?.trim() ? (
              <Text style={estilos.filaSubtitulo} numberOfLines={2}>
                {item.observaciones.trim()}
              </Text>
            ) : null}
            <EstadoPush fila={item} />
          </TouchableOpacity>
        )}
      />

      <PickerModal
        visible={abierto === "productor"}
        titulo="Filtrar por productor"
        opciones={productores}
        onSeleccionar={setFiltroProductor}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "tipo"}
        titulo="Filtrar por tipo de visita"
        opciones={opcionesTipo}
        onSeleccionar={setFiltroTipo}
        onCerrar={() => setAbierto(null)}
      />
    </View>
  );
}
