import { useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { crearSolicitud } from "../lib/crear";
import { syncNow } from "../lib/sync";
import { colores, estilos, fmtMoneda } from "./estilos";
import { PickerModal } from "./componentes/Picker";
import { useOpcionesProductor } from "./componentes/opciones";
import {
  aNumero,
  BotonPrimario,
  CampoNumero,
  CampoSeleccion,
  CampoTexto,
} from "./componentes/Campos";

/**
 * Alta de solicitud de crédito en campo.
 *
 * Se guarda SIEMPRE local primero y recién después se intenta sincronizar: el
 * promotor está en un cafetal sin señal la mitad del tiempo, y perder el dato
 * porque no había red sería el peor resultado posible. Si el sync falla, la
 * solicitud queda con badge "PENDIENTE" y sube en el próximo intento.
 *
 * Los entregadores se agregan después, desde el detalle — el form ya es largo
 * y en la práctica el promotor primero cierra el monto con el productor.
 */
export function NuevaSolicitudScreen({ navigation }: Readonly<{ navigation: any }>) {
  const productores = useOpcionesProductor();

  const [productorId, setProductorId] = useState<string | null>(null);
  const [pickerAbierto, setPickerAbierto] = useState(false);
  const [cosecha, setCosecha] = useState("");
  const [zona, setZona] = useState("");
  const [efectivo, setEfectivo] = useState("");
  const [insumos, setInsumos] = useState("");
  const [almacigo, setAlmacigo] = useState("");
  const [formalizacion, setFormalizacion] = useState("");
  const [otros, setOtros] = useState("");
  const [planInversion, setPlanInversion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [prodEstimada, setProdEstimada] = useState("");
  const [entregaEstimada, setEntregaEstimada] = useState("");
  const [guardando, setGuardando] = useState(false);

  const productor = productores.find((p) => p.valor === productorId);

  const total = useMemo(
    () =>
      (aNumero(efectivo) ?? 0) +
      (aNumero(insumos) ?? 0) +
      (aNumero(almacigo) ?? 0) +
      (aNumero(formalizacion) ?? 0) +
      (aNumero(otros) ?? 0),
    [efectivo, insumos, almacigo, formalizacion, otros]
  );

  const puedeGuardar = productorId != null && total > 0 && !guardando;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      const idSocio = Number(productorId);
      if (Number.isNaN(idSocio)) throw new Error("Productor inválido.");

      const solicitud = await crearSolicitud({
        idSocio,
        codigo: productor?.subtitulo?.split(" · ")[0] ?? null,
        cosecha: cosecha.trim() || null,
        zona: zona.trim() || null,
        efectivo: aNumero(efectivo) ?? undefined,
        insumos: aNumero(insumos) ?? undefined,
        almacigo: aNumero(almacigo) ?? undefined,
        formalizacion: aNumero(formalizacion) ?? undefined,
        otros: aNumero(otros) ?? undefined,
        planInversion: planInversion.trim() || null,
        motivo: motivo.trim() || null,
        prodEstimada: aNumero(prodEstimada),
        entregaEstimada: aNumero(entregaEstimada),
      });

      // Sync best-effort. El dato ya está a salvo en SQLite local.
      syncNow().catch((e) =>
        console.warn("sync tras crear solicitud", (e as Error)?.message)
      );

      navigation.replace("SolicitudDetail", { solicitudId: solicitud.id });
    } catch (e) {
      Alert.alert("No se pudo guardar", (e as Error)?.message ?? "Error desconocido");
      setGuardando(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={estilos.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={estilos.seccion}>Productor</Text>
        <CampoSeleccion
          etiqueta="Productor"
          requerido
          valorMostrado={productor?.titulo ?? null}
          onAbrir={() => setPickerAbierto(true)}
        />
        <CampoTexto etiqueta="Cosecha" valor={cosecha} onCambiar={setCosecha} placeholder="2526" />
        <CampoTexto etiqueta="Zona" valor={zona} onCambiar={setZona} />

        <Text style={estilos.seccion}>Rubros</Text>
        <CampoNumero etiqueta="Efectivo" valor={efectivo} onCambiar={setEfectivo} />
        <CampoNumero etiqueta="Insumos" valor={insumos} onCambiar={setInsumos} />
        <CampoNumero etiqueta="Almácigo" valor={almacigo} onCambiar={setAlmacigo} />
        <CampoNumero etiqueta="Formalización" valor={formalizacion} onCambiar={setFormalizacion} />
        <CampoNumero etiqueta="Otros" valor={otros} onCambiar={setOtros} />

        <View style={[estilos.detalleFila, { marginTop: 16 }]}>
          <Text style={[estilos.detalleEtiqueta, { fontWeight: "700" }]}>Total</Text>
          <Text
            style={[
              estilos.detalleValor,
              { fontSize: 18, color: total > 0 ? colores.exito : colores.textoTenue },
            ]}
          >
            {fmtMoneda(total)}
          </Text>
        </View>

        <Text style={estilos.seccion}>Plan y estimados</Text>
        <CampoTexto
          etiqueta="Plan de inversión"
          valor={planInversion}
          onCambiar={setPlanInversion}
          multilinea
        />
        <CampoTexto etiqueta="Motivo" valor={motivo} onCambiar={setMotivo} />
        <CampoNumero etiqueta="Producción estimada" valor={prodEstimada} onCambiar={setProdEstimada} />
        <CampoNumero etiqueta="Entrega estimada" valor={entregaEstimada} onCambiar={setEntregaEstimada} />

        <BotonPrimario
          texto={guardando ? "Guardando..." : "Guardar solicitud"}
          onPress={guardar}
          deshabilitado={!puedeGuardar}
        />
        {total <= 0 && (
          <Text style={[estilos.vacioTexto, { paddingTop: 10 }]}>
            Cargá al menos un rubro para poder guardar.
          </Text>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      <PickerModal
        visible={pickerAbierto}
        titulo="Elegir productor"
        opciones={productores}
        onSeleccionar={setProductorId}
        onCerrar={() => setPickerAbierto(false)}
      />
    </KeyboardAvoidingView>
  );
}
