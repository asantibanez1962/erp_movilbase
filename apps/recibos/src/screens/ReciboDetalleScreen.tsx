import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { Recibo } from "../db/models";
import { cliente } from "../branding";
import { anularRecibo, esAnulado, marcarImpreso } from "../lib/recibo";
import { imprimirRecibo } from "../lib/imprimir";
import { colores, estilos, fmtCajuelas, fmtFechaHora } from "./estilos";
import { useCatalogos } from "./useCatalogos";

/**
 * Un recibo ya emitido. Sólo lectura, y con una sola acción: anular.
 *
 * ⚠️ NO SE EDITA. El papel ya está en manos del productor y una copia impresa después
 * tiene que reproducir el original que se firmó. Corregir cantidades acá dejaría el papel
 * y la base diciendo cosas distintas, sin que nada avise.
 *
 * Por eso anular pone todo en cero en vez de borrar: **preserva el número en la
 * secuencia**. Un hueco es indistinguible de un recibo perdido, y ésa es la duda cara —
 * alguien sale a buscar un papel que nunca existió.
 */
export function ReciboDetalleScreen({
  recibo,
  onVolver,
}: Readonly<{ recibo: Recibo; onVolver: () => void }>) {
  const navigation = useNavigation();
  const [, setTick] = useState(0);
  const catalogos = useCatalogos();
  const certificado = catalogos.certificado(recibo.idCertificado);
  const anulado = esAnulado(recibo);
  const impreso = (recibo.impreso ?? 0) >= 1;

  // El recibo es un modelo vivo de WatermelonDB: al anularlo cambia bajo los pies de la
  // pantalla, y sin observarlo seguiría mostrando las cantidades viejas.
  useEffect(() => {
    const sub = recibo.observe().subscribe(() => setTick((n) => n + 1));
    return () => sub.unsubscribe();
  }, [recibo]);

  const anular = () => {
    Alert.alert(
      `Anular ${recibo.recibo}`,
      "Las cantidades quedan en cero y el recibo se marca ANULADO. El número se conserva " +
        "para que no quede un hueco en la secuencia.\n\nNo se puede deshacer.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Anular",
          style: "destructive",
          onPress: () => {
            anularRecibo(recibo).catch((e: Error) =>
              Alert.alert("No se pudo anular", e.message)
            );
          },
        },
      ]
    );
  };

  const menu = () => {
    const opciones: Array<{
      text: string;
      style?: "cancel" | "destructive";
      onPress?: () => void;
    }> = [];

    // La primera sale ORIGINAL y las demás COPIA: lo decide el contador `impreso`, igual
    // que en el web. Reimprimir uno anulado sigue permitido a propósito — el papel dice
    // ANULADO y con cantidades en cero, que es justo lo que hay que poder mostrar.
    opciones.push({
      text: impreso ? "Imprimir copia" : "Imprimir",
      onPress: () => {
        imprimirRecibo(recibo)
          .then(() => marcarImpreso(recibo))
          .catch((e: Error) => Alert.alert("No se pudo imprimir", e.message));
      },
    });

    // ⚠️ Anular EXIGE que esté impreso. Un recibo sin imprimir no salió del teléfono ni
    // existe en papel: ése se descarta, no se anula.
    if (impreso && !anulado) opciones.push({ text: "Anular", style: "destructive", onPress: anular });

    opciones.push({ text: "Cerrar", style: "cancel" });

    Alert.alert(
      recibo.recibo,
      anulado
        ? "Este recibo está anulado."
        : impreso
          ? undefined
          : "Sin imprimir: todavía no sincroniza, y por eso tampoco se puede anular.",
      opciones
    );
  };

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={menu}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ paddingHorizontal: 10 }}
        >
          <Text style={{ color: "#f1f5f9", fontSize: 22, fontWeight: "700" }}>⋮</Text>
        </TouchableOpacity>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, anulado, impreso]);

  return (
    <ScrollView style={estilos.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Text style={{ fontSize: 24, fontWeight: "700", color: colores.texto }}>
          {recibo.recibo}
        </Text>
        <View style={{ flex: 1 }} />
        <Estado anulado={anulado} impreso={recibo.impreso ?? 0} />
      </View>

      {/* ⚠️ POR NOMBRE, NUNCA POR CÓDIGO. Las columnas guardan `M` y `2`; el recibidor
          eligió "Maduro" y "DIF O-01". Mostrar el crudo no da ningún error — se ve raro y
          ya— y en una pantalla de sólo lectura, que existe para confirmar lo que salió
          impreso, es justo donde más estorba. Ver el comentario de useCatalogos: éste es
          el cuarto lugar donde apareció el mismo problema. */}
      <Dato etiqueta="Fecha" valor={fmtFechaHora(recibo.fecha)} />
      <Dato etiqueta="Productor" valor={recibo.nombre ?? recibo.codigo ?? "—"} />
      <Dato etiqueta="Identificación" valor={recibo.cedula ?? "—"} />
      <Dato etiqueta="Calidad" valor={catalogos.calidad(recibo.calidad)} />
      <Dato etiqueta="Tipo de café" valor={catalogos.tipoCafe(recibo.tipoCafe)} />
      {/* Los dos sólo aparecen cuando aplican: un renglón vacío se lee como dato
          faltante, y acá lo que se está confirmando es lo que dice el papel. */}
      {(recibo.cldd ?? 0) !== 0 ? <Dato etiqueta="CLDD" valor="Sí" /> : null}
      {certificado ? <Dato etiqueta="Certificado" valor={certificado} /> : null}

      <Text style={estilos.seccion}>Medida</Text>
      <Dato
        etiqueta="Bruto"
        valor={fmtCajuelas(recibo.cantidadinicial, recibo.cuartillosinicial)}
      />
      <Dato etiqueta="% Verdes" valor={recibo.verdes.toFixed(2)} />
      <Dato etiqueta="% Flote maduro" valor={recibo.flotemaduro.toFixed(2)} />
      <Dato etiqueta="% Flote seco" valor={recibo.floteseco.toFixed(2)} />
      <Dato etiqueta="Granos brocados" valor={String(recibo.granosbrocados)} />

      <View
        style={{
          backgroundColor: anulado ? colores.textoTenue : cliente.chrome,
          marginHorizontal: 16,
          marginTop: 16,
          borderRadius: 10,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: "#f1f5f9", fontSize: 14, fontWeight: "700" }}>
          TOTAL RECIBO
        </Text>
        <Text style={{ color: "#f1f5f9", fontSize: 28, fontWeight: "700" }}>
          {fmtCajuelas(recibo.rcantidad, recibo.rcantidadcuartillos)}
        </Text>
      </View>

      {recibo.observaciones ? (
        <Dato etiqueta="Observaciones" valor={recibo.observaciones} />
      ) : null}

      <View style={{ padding: 20 }}>
        <TouchableOpacity
          onPress={onVolver}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colores.textoTenue, fontSize: 14 }}>Volver</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

/** ORIGINAL / COPIA salen del contador `impreso`: 1 es el original, 2 o más son copias. */
function Estado({ anulado, impreso }: Readonly<{ anulado: boolean; impreso: number }>) {
  let texto: string;
  let color: string;
  if (anulado) {
    texto = "ANULADO";
    color = colores.error;
  } else if (impreso === 0) {
    texto = "SIN IMPRIMIR";
    color = colores.advertencia;
  } else if (impreso === 1) {
    texto = "ORIGINAL";
    color = colores.exito;
  } else {
    texto = `${impreso - 1} COPIA${impreso - 1 === 1 ? "" : "S"}`;
    color = colores.textoTenue;
  }
  return (
    <View style={{ backgroundColor: color, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{texto}</Text>
    </View>
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
