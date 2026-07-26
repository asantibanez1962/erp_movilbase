import { useEffect, useMemo, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Productor, Solicitud, TipoDesembolso } from "../db/models";
import { database } from "../lib/db";
import { actualizarSolicitud, crearSolicitud } from "../lib/crear";
import { useSesion } from "../lib/sesion";
import { estilos, fmtFecha } from "./estilos";
import { PickerModal } from "./componentes/Picker";
import { useOpcionesProductor } from "./componentes/opciones";
import { etiquetaZona, useNombresZona } from "./useNombresZona";
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
 * Variante tipo + total, que es la que se usa: de 937 solicitudes de las últimas
 * dos cosechas, 923 tienen `tipocredito` y sólo 1 los rubros sueltos
 * (efectivo/insumos/almácigo/...). El master soporta las dos; el móvil captura ésta.
 *
 * Lo que NO se pide acá, a propósito:
 *   - cosecha → de la sesión de trabajo
 *   - zona    → del productor elegido
 *   - tasa, mora, inicio de interés, plazo → los deriva el BE de la cosecha y del
 *     tipo (rc_cosechas + rc_tipodesembolso.modifica_intereses). Si los mandara el
 *     teléfono, una cosecha cacheada vieja escribiría una tasa equivocada.
 *   - abono / tipo abono → los pone la oficina (1 de 937 solicitudes los usa)
 *
 * Se guarda SIEMPRE local primero y después se intenta sincronizar: el promotor
 * está en un cafetal sin señal la mitad del tiempo, y perder el dato por eso sería
 * el peor resultado posible.
 *
 * Los entregadores se agregan desde la pestaña del detalle, no acá: mantiene este
 * form en una sola pantalla y sigue el mismo patrón que el form web.
 */
export function NuevaSolicitudScreen({
  navigation,
  route,
}: Readonly<{ navigation: any; route: any }>) {
  // Con solicitudId el form entra en modo edición. Se reusa la misma pantalla
  // para no mantener dos listas de campos que se desincronizan.
  const solicitudId: string | undefined = route?.params?.solicitudId;
  const [editando, setEditando] = useState<Solicitud | null>(null);
  const productores = useOpcionesProductor();
  const cosechaSesion = useSesion((s) => s.cosecha);
  const nombresZona = useNombresZona();

  const [tipos, setTipos] = useState<TipoDesembolso[]>([]);
  const [productorId, setProductorId] = useState<string | null>(null);
  const [zonaProductor, setZonaProductor] = useState<string | null>(null);
  const [codigoProductor, setCodigoProductor] = useState<string | null>(null);
  const [tipoId, setTipoId] = useState<number | null>(null);
  const [total, setTotal] = useState("");
  const [planInversion, setPlanInversion] = useState("");
  const [motivo, setMotivo] = useState("");
  const [prodEstimada, setProdEstimada] = useState("");
  const [entregaEstimada, setEntregaEstimada] = useState("");
  const [abierto, setAbierto] = useState<"productor" | "tipo" | null>(null);
  const [guardando, setGuardando] = useState(false);

  // La fecha se fija al abrir el form, no al guardar: si el promotor deja la
  // pantalla abierta cruzando la medianoche, la solicitud queda con el día en que
  // realmente la levantó.
  const [fecha] = useState(() => new Date());

  useEffect(() => {
    const sub = database
      .get<TipoDesembolso>("tipos_desembolso")
      .query(Q.sortBy("id_tipo_desembolso", Q.asc))
      .observe()
      .subscribe(setTipos);
    return () => sub.unsubscribe();
  }, []);

  // Modo edición: precargar la solicitud existente.
  useEffect(() => {
    if (!solicitudId) return;
    let cancelado = false;
    database
      .get<Solicitud>("solicitudes")
      .find(solicitudId)
      .then((s) => {
        if (cancelado) return;
        setEditando(s);
        setProductorId(s.idSocio != null ? String(s.idSocio) : null);
        setTipoId(s.tipoCredito ?? null);
        setTotal(s.total != null ? String(s.total) : "");
        setPlanInversion(s.planInversion ?? "");
        setMotivo(s.motivo ?? "");
        setProdEstimada(s.prodEstimada != null ? String(s.prodEstimada) : "");
        setEntregaEstimada(
          s.entregaEstimada != null ? String(s.entregaEstimada) : ""
        );
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [solicitudId]);

  // Al elegir productor se traen su zona y su código: la solicitud los hereda.
  useEffect(() => {
    if (productorId == null) {
      setZonaProductor(null);
      setCodigoProductor(null);
      return;
    }
    let cancelado = false;
    database
      .get<Productor>("productores")
      .find(productorId)
      .then((p) => {
        if (cancelado) return;
        setZonaProductor(p.rcZona?.trim() || null);
        setCodigoProductor(p.rcCodigo?.trim() || p.codigo?.trim() || null);
      })
      .catch(() => undefined);
    return () => {
      cancelado = true;
    };
  }, [productorId]);

  const productor = productores.find((p) => p.valor === productorId);
  const tipo = tipos.find((t) => t.idTipoDesembolso === tipoId);
  const montoTotal = aNumero(total);

  const opcionesTipo = useMemo(
    () =>
      tipos.map((t) => ({
        valor: String(t.idTipoDesembolso),
        titulo: t.nombre ?? `Tipo ${t.idTipoDesembolso}`,
      })),
    [tipos]
  );

  const puedeGuardar =
    productorId != null && tipoId != null && (montoTotal ?? 0) > 0 && !guardando;

  const guardar = async () => {
    if (!puedeGuardar || tipoId == null) return;
    setGuardando(true);
    try {
      const idSocio = Number(productorId);
      if (Number.isNaN(idSocio)) throw new Error("Productor inválido.");

      const datos = {
        tipoCredito: tipoId,
        total: montoTotal ?? 0,
        planInversion: planInversion.trim() || null,
        motivo: motivo.trim() || null,
        prodEstimada: aNumero(prodEstimada),
        entregaEstimada: aNumero(entregaEstimada),
      };

      if (editando) {
        await actualizarSolicitud(editando, datos);
        navigation.goBack();
        return;
      }

      const solicitud = await crearSolicitud({
        idSocio,
        codigo: codigoProductor,
        zona: zonaProductor,
        fecha,
        ...datos,
      });

      // NO se sincroniza acá a propósito. La solicitud sólo se puede editar
      // mientras no subió, así que un sync automático al guardar la volvía de
      // solo lectura en segundos — sin darle tiempo al promotor de agregar los
      // entregadores ni de corregir un monto. El sync lo dispara él desde el
      // drawer cuando terminó de capturar.
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
        <Text style={estilos.seccion}>Solicitud</Text>

        {/* El productor no se cambia al editar: la zona, el código y los
            entregadores ya cuelgan de él. Para otro productor, otra solicitud. */}
        <CampoSeleccion
          etiqueta="Productor"
          requerido
          deshabilitado={editando != null}
          valorMostrado={productor?.titulo ?? null}
          onAbrir={() => setAbierto("productor")}
        />

        {/* Heredados: no se piden. Se muestran para que el promotor confirme que
            eligió al productor correcto antes de guardar. */}
        <View style={estilos.detalleFila}>
          <Text style={estilos.detalleEtiqueta}>Zona</Text>
          {/* Por nombre: el código ('5') no le dice nada al promotor. */}
          <Text style={estilos.detalleValor}>
            {etiquetaZona(nombresZona, zonaProductor)}
          </Text>
        </View>
        <View style={estilos.detalleFila}>
          <Text style={estilos.detalleEtiqueta}>Cosecha</Text>
          <Text style={estilos.detalleValor}>{cosechaSesion ?? "—"}</Text>
        </View>
        <View style={estilos.detalleFila}>
          <Text style={estilos.detalleEtiqueta}>Fecha</Text>
          <Text style={estilos.detalleValor}>{fmtFecha(fecha.getTime())}</Text>
        </View>

        <CampoSeleccion
          etiqueta="Tipo de crédito"
          requerido
          valorMostrado={tipo?.nombre ?? null}
          onAbrir={() => setAbierto("tipo")}
        />
        <CampoNumero etiqueta="Monto total" valor={total} onCambiar={setTotal} />

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
          texto={
            guardando
              ? "Guardando..."
              : editando
                ? "Guardar cambios"
                : "Guardar solicitud"
          }
          onPress={guardar}
          deshabilitado={!puedeGuardar}
        />
        {(montoTotal ?? 0) <= 0 ? (
          <Text style={[estilos.vacioTexto, { paddingTop: 10 }]}>
            Elegí productor y tipo, y cargá el monto total.
          </Text>
        ) : null}
        <Text style={[estilos.vacioTexto, { paddingTop: 10 }]}>
          Los entregadores se agregan después, desde la pestaña del detalle.
        </Text>
        <View style={{ height: 40 }} />
      </ScrollView>

      <PickerModal
        visible={abierto === "productor"}
        titulo="Elegir productor"
        opciones={productores}
        onSeleccionar={setProductorId}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "tipo"}
        titulo="Tipo de crédito"
        opciones={opcionesTipo}
        onSeleccionar={(v) => setTipoId(Number(v))}
        onCerrar={() => setAbierto(null)}
      />
    </KeyboardAvoidingView>
  );
}
