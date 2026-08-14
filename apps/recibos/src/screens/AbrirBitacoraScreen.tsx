import { useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Q } from "@nozbe/watermelondb";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "../branding";
import { database } from "../lib/db";
import { abrirBitacora, editarBitacora } from "../lib/bitacora";
import type { Bitacora, TipoCafe, Transportista } from "../db/models";
import { PickerModal, type OpcionPicker } from "./Picker";
import { colores, estilos } from "./estilos";

/**
 * Abrir la bitácora.
 *
 * Todo lo que se puede deducir, se deduce: la fecha es hoy, la hora de inicio es ahora,
 * el medidor es el usuario de la app. Lo único que se pregunta es lo que la app no puede
 * saber — el tipo de café del día, el transportista y la placa.
 *
 * El transportista sale del catálogo y no es texto libre: se escribe con una mano, bajo
 * el sol, y un nombre mal tipeado no cruza después con nada en la oficina.
 *
 * Nada de esto necesita red. Es una fila local, y sale del teléfono recién al cerrar.
 */
export function AbrirBitacoraScreen({
  bitacora,
  onListo,
  onCancelar,
}: Readonly<{
  /** Presente ⇒ se EDITA una bitácora abierta en vez de abrir una nueva. */
  bitacora?: Bitacora;
  onListo: (b: Bitacora) => void;
  onCancelar: () => void;
}>) {
  const editando = bitacora != null;
  const insets = useSafeAreaInsets();
  const usuario = useAuthStore((s) => s.user?.usuario ?? "—");
  const [tiposCafe, setTiposCafe] = useState<OpcionPicker[]>([]);
  const [transportistas, setTransportistas] = useState<OpcionPicker[]>([]);

  const [tipocafe, setTipocafe] = useState<string | null>(bitacora?.tipocafe ?? null);
  const [transportista, setTransportista] = useState<string | null>(
    bitacora?.transportista ?? null
  );
  const [placacamion, setPlaca] = useState(bitacora?.placacamion ?? "");
  const [observaciones, setObs] = useState(bitacora?.observaciones ?? "");
  const [picker, setPicker] = useState<"tipo" | "transportista" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void (async () => {
      const [tc, tr] = await Promise.all([
        database.get<TipoCafe>("tipos_cafe").query(Q.sortBy("tipocafe", Q.asc)).fetch(),
        database
          .get<Transportista>("transportistas")
          .query(Q.sortBy("nombre", Q.asc))
          .fetch(),
      ]);
      setTiposCafe(
        tc.map((t) => ({
          valor: t.tipocafe,
          titulo: t.nombre ?? t.tipocafe,
          subtitulo: t.tipocafe,
        }))
      );
      setTransportistas(
        tr.map((t) => ({
          valor: t.transportista,
          titulo: t.nombre ?? t.transportista,
          subtitulo: t.transportista,
        }))
      );
    })();
  }, []);

  const guardar = async () => {
    if (guardando || !tipocafe) return;
    setGuardando(true);
    setError(null);
    try {
      const datos = {
        tipocafe,
        transportista,
        placacamion: placacamion.trim() || null,
        observaciones: observaciones.trim() || null,
      };
      const b = editando ? await editarBitacora(bitacora, datos) : await abrirBitacora(datos);
      onListo(b);
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo abrir la bitácora.");
      setGuardando(false);
    }
  };

  const nombreDe = (ops: OpcionPicker[], v: string | null) =>
    v == null ? "Elegir..." : (ops.find((o) => o.valor === v)?.titulo ?? v);

  return (
    <ScrollView
      style={estilos.root}
      // Despeja la barra de navegación de Android: sin esto el botón de abajo queda
      // debajo de los controles del sistema.
      contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
    >
      <View style={{ padding: 20, gap: 4 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colores.texto }}>
          {editando ? "Datos de la bitácora" : "Abrir bitácora"}
        </Text>
        <Text style={{ color: colores.textoTenue, fontSize: 14 }}>
          {editando
            ? "El transportista y la placa se pueden completar mientras la bitácora esté abierta."
            : "La fecha, la hora y el medidor se llenan solos."}
        </Text>
      </View>

      {editando ? null : (
        <>
          <Text style={estilos.seccion}>Automático</Text>
          <Dato etiqueta="Fecha" valor={new Date().toLocaleDateString("es-CR")} />
          <Dato
            etiqueta="Hora de inicio"
            valor={new Date().toLocaleTimeString("es-CR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          />
          <Dato etiqueta="Medidor" valor={usuario} />
        </>
      )}

      <Text style={estilos.seccion}>De la bitácora</Text>
      {/* OBLIGATORIO. El tipo de café decide el PRECIO de todos los recibos de la
          jornada: buscarPrecio() filtra por él, así que sin tipo ningún recibo del día
          encuentra precio. Dejar abrir sin esto era abrir un día entero condenado. */}
      <Selector
        etiqueta="Tipo de café"
        valor={nombreDe(tiposCafe, tipocafe)}
        onPress={() => setPicker("tipo")}
      />
      <Selector
        etiqueta="Transportista"
        valor={nombreDe(transportistas, transportista)}
        onPress={() => setPicker("transportista")}
      />

      <Text style={estilos.seccion}>Camión</Text>
      <View style={{ paddingHorizontal: 12 }}>
        <TextInput
          style={estilos.buscador}
          value={placacamion}
          onChangeText={setPlaca}
          placeholder="Placa"
          placeholderTextColor={colores.textoTenue}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={20}
        />
        <TextInput
          style={estilos.buscador}
          value={observaciones}
          onChangeText={setObs}
          placeholder="Observaciones (opcional)"
          placeholderTextColor={colores.textoTenue}
          maxLength={100}
        />
      </View>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      <View style={{ padding: 20, gap: 12 }}>
        <TouchableOpacity
          onPress={guardar}
          disabled={guardando || !tipocafe}
          style={{
            backgroundColor: tipocafe ? cliente.chrome : colores.borde,
            borderRadius: 10,
            minHeight: 50,
            alignItems: "center",
            justifyContent: "center",
            opacity: guardando ? 0.6 : 1,
          }}
        >
          <Text
            style={{
              color: tipocafe ? "#f1f5f9" : colores.textoTenue,
              fontWeight: "700",
              fontSize: 16,
            }}
          >
            {editando ? "Guardar" : "Abrir bitácora"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCancelar}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colores.textoTenue, fontSize: 14 }}>Cancelar</Text>
        </TouchableOpacity>
      </View>

      <PickerModal
        visible={picker === "tipo"}
        titulo="Tipo de café"
        opciones={tiposCafe}
        onSeleccionar={(v) => {
          setTipocafe(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
      <PickerModal
        visible={picker === "transportista"}
        titulo="Transportista"
        opciones={transportistas}
        onSeleccionar={(v) => {
          setTransportista(v);
          setPicker(null);
        }}
        onCerrar={() => setPicker(null)}
      />
    </ScrollView>
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

function Selector({
  etiqueta,
  valor,
  onPress,
}: Readonly<{ etiqueta: string; valor: string; onPress: () => void }>) {
  return (
    <TouchableOpacity onPress={onPress} style={[estilos.detalleFila, { minHeight: 52 }]}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={[estilos.detalleValor, { color: cliente.chrome }]}>{valor} ›</Text>
    </TouchableOpacity>
  );
}
