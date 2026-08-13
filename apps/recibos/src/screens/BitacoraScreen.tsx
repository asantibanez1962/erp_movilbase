import { useEffect, useState } from "react";
import { Alert, FlatList, Text, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Bitacora, Recibo } from "../db/models";
import { cliente } from "../branding";
import { cerrarBitacora, recibosDe } from "../lib/bitacora";
import { colores, estilos, fmtCajuelas, fmtFecha } from "./estilos";
import { useCatalogos } from "./useCatalogos";

/**
 * Una jornada: sus datos, sus recibos, y el cierre.
 *
 * ⚠️ CERRAR ES IMPRIMIR. No hay un botón de "cerrar" separado del de imprimir, porque el
 * estado intermedio —cerrada pero sin papel— es el que genera dudas en el campo, y el
 * camión se lleva el papel. Una vez cerrada no admite más recibos; si hay que seguir
 * recibiendo, se abre otra.
 */
export function BitacoraScreen({
  bitacora,
  onVolver,
  onNuevoRecibo,
  onEditar,
  onVerRecibo,
}: Readonly<{
  bitacora: Bitacora;
  onVolver: () => void;
  onNuevoRecibo: () => void;
  onEditar: () => void;
  onVerRecibo: (r: Recibo) => void;
}>) {
  // Los botones fijos de abajo tienen que despejar la barra de navegación de Android.
  const insets = useSafeAreaInsets();
  const catalogos = useCatalogos();
  const [recibos, setRecibos] = useState<Recibo[] | null>(null);
  const [cerrando, setCerrando] = useState(false);
  // Fuerza el re-render cuando la bitácora cambia. Sin esto, editar el transportista o la
  // placa no se veía al volver: el modelo es el mismo objeto y React no tiene cómo
  // enterarse de que sus campos cambiaron. Había que salir hasta la lista y volver a
  // entrar, que es justo el síntoma que uno atribuye a "no se guardó".
  const [, setTick] = useState(0);
  const abierta = bitacora.estaAbierta;

  useEffect(() => {
    const sub = recibosDe(bitacora.id).observe().subscribe(setRecibos);
    return () => sub.unsubscribe();
  }, [bitacora.id]);

  useEffect(() => {
    const sub = bitacora.observe().subscribe(() => setTick((n) => n + 1));
    return () => sub.unsubscribe();
  }, [bitacora]);

  const cerrar = async (simulada: boolean) => {
    if (cerrando) return;
    setCerrando(true);
    try {
      const { falloSync } = await cerrarBitacora(bitacora, imprimirPendiente, { simulada });
      if (falloSync) {
        Alert.alert(
          "Cerrada, pero sin enviar",
          `La jornada quedó cerrada. No se pudo sincronizar: ${falloSync}.\n\n` +
            "Se reintenta cuando haya señal; los datos no se pierden."
        );
      }
      onVolver();
    } catch (e) {
      Alert.alert("No se pudo cerrar", (e as Error)?.message ?? "Error desconocido");
    } finally {
      setCerrando(false);
    }
  };

  const confirmarCierre = () => {
    Alert.alert(
      "Cerrar jornada",
      `Se imprime el reporte del día y se envían al servidor la bitácora y sus ${
        recibos?.length ?? 0
      } recibos.\n\nDespués no admite más recibos.`,
      [
        { text: "Cancelar", style: "cancel" },
        // La válvula de escape de la operación: sin ella, un rollo que se acaba a las
        // cinco de la tarde deja el día atrapado en el teléfono y la oficina sin saber
        // que existió. Queda anotado en las observaciones.
        { text: "Sin papel", onPress: () => void cerrar(true) },
        { text: "Imprimir y cerrar", onPress: () => void cerrar(false) },
      ]
    );
  };

  return (
    <View style={estilos.root}>
      <FlatList
        data={recibos ?? []}
        keyExtractor={(r) => r.id}
        ListHeaderComponent={
          <View>
            <View style={{ padding: 20, paddingBottom: 8, gap: 4 }}>
              <Text style={{ fontSize: 22, fontWeight: "700", color: colores.texto }}>
                {fmtFecha(bitacora.fecha)}
              </Text>
              <View
                style={[
                  estilos.badge,
                  { backgroundColor: abierta ? colores.exito : colores.textoTenue },
                ]}
              >
                <Text style={estilos.badgeTexto}>{abierta ? "ABIERTA" : "CERRADA"}</Text>
              </View>
            </View>

            <Dato etiqueta="Medidor" valor={bitacora.medidor ?? "—"} />
            <Dato etiqueta="Tipo de café" valor={catalogos.tipoCafe(bitacora.tipocafe)} />
            <Dato
              etiqueta="Transportista"
              valor={catalogos.transportista(bitacora.transportista)}
            />
            <Dato etiqueta="Placa" valor={bitacora.placacamion ?? "—"} />
            {bitacora.observaciones ? (
              <Dato etiqueta="Observaciones" valor={bitacora.observaciones} />
            ) : null}

            {/* El camión y su placa se saben al FINAL del día, no al abrir. Sin esta
                entrada la jornada quedaba con los campos vacíos para siempre. */}
            {abierta ? (
              <TouchableOpacity onPress={onEditar} style={estilos.detalleFila}>
                <Text style={estilos.detalleEtiqueta}>Completar datos del camión</Text>
                <Text style={[estilos.detalleValor, { color: cliente.chrome }]}>
                  Editar ›
                </Text>
              </TouchableOpacity>
            ) : null}

            <Text style={estilos.seccion}>
              Recibos {recibos ? `(${recibos.length})` : ""}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <FilaRecibo recibo={item} onPress={() => onVerRecibo(item)} />
        )}
        ListEmptyComponent={
          recibos == null ? null : (
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>
                Todavía no hay recibos en esta jornada.
              </Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
      />

      {abierta ? (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 20 + insets.bottom,
            gap: 10,
          }}
        >
          <TouchableOpacity
            onPress={onNuevoRecibo}
            style={{
              backgroundColor: cliente.chrome,
              borderRadius: 12,
              minHeight: 54,
              alignItems: "center",
              justifyContent: "center",
              elevation: 4,
            }}
          >
            <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 16 }}>
              + Nuevo recibo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={confirmarCierre}
            disabled={cerrando}
            style={{
              backgroundColor: colores.superficie,
              borderWidth: 1,
              borderColor: colores.borde,
              borderRadius: 12,
              minHeight: 50,
              alignItems: "center",
              justifyContent: "center",
              opacity: cerrando ? 0.6 : 1,
            }}
          >
            <Text style={{ color: colores.texto, fontWeight: "600", fontSize: 15 }}>
              {cerrando ? "Cerrando..." : "Cerrar jornada e imprimir"}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

/**
 * La impresión real todavía no existe: ESC/POS por Bluetooth es el paso siguiente.
 *
 * Es a propósito que TIRE en vez de resolver en silencio. `cerrarBitacora` imprime antes
 * de marcar la hora final justamente para que un fallo deje la jornada abierta y se pueda
 * reintentar; si esto resolviera como si hubiera impreso, cerraría jornadas sin papel y
 * el camión saldría sin el reporte. Mientras tanto se cierra con la opción "Sin papel",
 * que es la misma válvula que usa la operación cuando se acaba el rollo — y queda
 * anotada en las observaciones en vez de fingir que se imprimió.
 */
async function imprimirPendiente(): Promise<void> {
  throw new Error(
    "La impresión por Bluetooth todavía no está implementada. " +
      'Para cerrar la jornada ahora, usá "Sin papel".'
  );
}

function FilaRecibo({
  recibo,
  onPress,
}: Readonly<{ recibo: Recibo; onPress: () => void }>) {
  return (
    <TouchableOpacity onPress={onPress} style={estilos.fila}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={estilos.filaTitulo}>{recibo.recibo}</Text>
        {/* La cantidad final descompuesta: `rcantidad` son las cajuelas enteras y
            `rcantidadcuartillos` el resto (0–3). `cantidad` es el neto decimal, que en
            el papel no se muestra. */}
        <Text style={estilos.filaTitulo}>
          {fmtCajuelas(recibo.rcantidad, recibo.rcantidadcuartillos)}
        </Text>
      </View>
      <Text style={estilos.filaSubtitulo}>{recibo.nombre ?? recibo.codigo ?? "—"}</Text>
      {recibo.impreso === 0 ? (
        <View style={[estilos.badge, { backgroundColor: colores.advertencia }]}>
          <Text style={estilos.badgeTexto}>SIN IMPRIMIR</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function Dato({ etiqueta, valor }: Readonly<{ etiqueta: string; valor: string }>) {
  return (
    <View style={estilos.detalleFila}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.detalleValor}>{valor}</Text>
    </View>
  );
}
