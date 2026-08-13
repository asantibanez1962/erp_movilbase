import { useEffect, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Bitacora } from "../db/models";
import { cliente } from "../branding";
import { todasLasBitacoras, recibosDe } from "../lib/bitacora";
import { useSesion } from "../lib/sesion";
import { colores, estilos, fmtFecha } from "./estilos";
import { useCatalogos, type Catalogos } from "./useCatalogos";

/**
 * Las jornadas del recibidor: la de hoy arriba, las anteriores debajo.
 *
 * Es la pantalla de inicio porque es donde empieza el día: sin una bitácora abierta no
 * se puede hacer un recibo, y ése es el orden real de la operación.
 *
 * Puede haber VARIAS abiertas a la vez —hay clientes que separan la jornada por
 * categoría de café— así que la lista no asume una sola.
 */
export function BitacorasScreen({
  onAbrir,
  onEntrar,
}: Readonly<{ onAbrir: () => void; onEntrar: (b: Bitacora) => void }>) {
  // El botón flotante y el fondo de la lista tienen que despejar la barra de navegación
  // de Android, que en los teléfonos con gestos o con botones en pantalla se come los
  // últimos ~48dp. Sin esto el botón queda debajo de los controles del sistema y no se
  // puede tocar.
  const insets = useSafeAreaInsets();
  const catalogos = useCatalogos();
  const recibidor = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [bitacoras, setBitacoras] = useState<Bitacora[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, number>>({});

  // observe() y no fetch(): al crear o cerrar una jornada la lista se actualiza sola,
  // sin que cada pantalla tenga que acordarse de refrescar a la vuelta.
  useEffect(() => {
    const sub = todasLasBitacoras().observe().subscribe(setBitacoras);
    return () => sub.unsubscribe();
  }, []);

  // El conteo de recibos va aparte: es una query por bitácora y no vale bloquear el
  // render de la lista esperándolos.
  useEffect(() => {
    if (!bitacoras) return;
    let vivo = true;
    void (async () => {
      const pares = await Promise.all(
        bitacoras.map(async (b) => [b.id, await recibosDe(b.id).fetchCount()] as const)
      );
      if (vivo) setConteos(Object.fromEntries(pares));
    })();
    return () => {
      vivo = false;
    };
  }, [bitacoras]);

  return (
    <View style={estilos.root}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
        <Text style={{ color: colores.textoTenue, fontSize: 13 }}>
          {recibidor} · {cosecha}
        </Text>
      </View>

      <FlatList
        data={bitacoras ?? []}
        keyExtractor={(b) => b.id}
        renderItem={({ item }) => (
          <Fila
            bitacora={item}
            recibos={conteos[item.id] ?? 0}
            catalogos={catalogos}
            onPress={() => onEntrar(item)}
          />
        )}
        ListEmptyComponent={
          bitacoras == null ? null : (
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>
                Todavía no abriste ninguna jornada.{"\n"}
                El día arranca acá: abrí la bitácora y después se le cuelgan los recibos.
              </Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
      />

      <TouchableOpacity
        onPress={onAbrir}
        style={{
          position: "absolute",
          right: 20,
          bottom: 24 + insets.bottom,
          backgroundColor: cliente.chrome,
          borderRadius: 28,
          paddingHorizontal: 22,
          minHeight: 56,
          alignItems: "center",
          justifyContent: "center",
          elevation: 4,
        }}
      >
        <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 15 }}>
          + Abrir jornada
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Fila({
  bitacora,
  recibos,
  catalogos,
  onPress,
}: Readonly<{
  bitacora: Bitacora;
  recibos: number;
  catalogos: Catalogos;
  onPress: () => void;
}>) {
  const abierta = bitacora.estaAbierta;
  return (
    <TouchableOpacity onPress={onPress} style={estilos.fila}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={estilos.filaTitulo}>{fmtFecha(bitacora.fecha)}</Text>
        <Text style={estilos.filaSubtitulo}>
          {recibos} {recibos === 1 ? "recibo" : "recibos"}
        </Text>
      </View>
      <Text style={estilos.filaSubtitulo}>
        {[
          bitacora.tipocafe ? catalogos.tipoCafe(bitacora.tipocafe) : null,
          bitacora.transportista ? catalogos.transportista(bitacora.transportista) : null,
          bitacora.placacamion,
        ]
          .filter(Boolean)
          .join(" · ") || "Sin transportista"}
      </Text>
      <View
        style={[
          estilos.badge,
          { backgroundColor: abierta ? colores.exito : colores.textoTenue },
        ]}
      >
        <Text style={estilos.badgeTexto}>{abierta ? "ABIERTA" : "CERRADA"}</Text>
      </View>
    </TouchableOpacity>
  );
}
