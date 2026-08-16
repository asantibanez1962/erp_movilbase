import { useEffect, useState } from "react";
import { FlatList, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Q } from "@nozbe/watermelondb";
import type { Bitacora, Recibo } from "../db/models";
import { cliente } from "../branding";
import { todasLasBitacoras } from "../lib/bitacora";
import { database } from "../lib/db";
import { useSesion } from "../lib/sesion";
import { colores, estilos, fmtFecha } from "./estilos";
import { useCatalogos, type Catalogos } from "./useCatalogos";

/**
 * Las bitácoras del recibidor: la de hoy arriba, las anteriores debajo.
 *
 * Es la pantalla de inicio porque es donde empieza el día: sin una bitácora abierta no
 * se puede hacer un recibo, y ése es el orden real de la operación.
 *
 * Puede haber VARIAS abiertas a la vez —hay clientes que separan la bitácora por
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
  // El CÓDIGO, aparte del nombre: el de arriba es para mostrar y éste para consultar.
  const recibidorId = useSesion((s) => s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [bitacoras, setBitacoras] = useState<Bitacora[] | null>(null);
  const [conteos, setConteos] = useState<Record<string, number>>({});

  // Observada y no leída con fetch(): al crear o cerrar una bitácora la lista se
  // actualiza sola, sin que cada pantalla tenga que acordarse de refrescar a la vuelta.
  //
  // ⚠️ Pero tiene que ser `observeWithColumns`. `observe()` sólo avisa cuando cambia el
  // CONJUNTO de filas —crear una bitácora—, y CERRARLA no crea ni borra nada: escribe
  // `hora_final` sobre una fila que ya estaba. Con `observe()` la mitad "o cerrar" de
  // este comentario era falsa, y la lista seguía mostrándola abierta. Ver la nota larga
  // en RecibosScreen, donde el mismo defecto hacía decir SIN IMPRIMIR a un recibo ya
  // impreso.
  useEffect(() => {
    const sub = todasLasBitacoras()
      .observeWithColumns([
        "hora_final", // de acá sale `estaAbierta`
        "impresiones",
        "fecha",
        "tipocafe",
        "transportista",
        "placacamion",
      ])
      .subscribe(setBitacoras);
    return () => sub.unsubscribe();
  }, []);

  /**
   * El conteo de recibos, OBSERVANDO LA TABLA DE RECIBOS.
   *
   * ⚠️ Antes contaba una vez por cada bitácora y el efecto dependía de `bitacoras`. El
   * problema es que agregar un recibo no cambia nada de la bitácora: la lista no se
   * re-emitía, el efecto no volvía a correr, y los conteos quedaban congelados en el
   * valor que tenían al abrir la pantalla. Se veía "0 recibos" en la lista y, al entrar
   * a esa misma bitácora, los dos recibos ahí.
   *
   * Ahora se observa la consulta de recibos —donde el alta SÍ cambia el conjunto, así
   * que `observe()` alcanza— y se agrupa por bitácora. De paso deja de ser una consulta
   * por fila: es una sola, y siempre al día.
   */
  useEffect(() => {
    const sub = database
      .get<Recibo>("recibos")
      .query(Q.where("recibidor", recibidorId ?? ""), Q.where("cosecha", cosecha ?? ""))
      .observe()
      .subscribe((rs) => {
        const acc: Record<string, number> = {};
        for (const r of rs) acc[r.idBitacora] = (acc[r.idBitacora] ?? 0) + 1;
        setConteos(acc);
      });
    return () => sub.unsubscribe();
  }, [recibidorId, cosecha]);

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
                Todavía no abriste ninguna bitácora.{"\n"}
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
          + Abrir bitácora
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
