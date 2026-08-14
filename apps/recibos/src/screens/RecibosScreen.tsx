import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Q } from "@nozbe/watermelondb";
import type { Recibo } from "../db/models";
import { cliente } from "../branding";
import { database } from "../lib/db";
import { esAnulado } from "../lib/recibo";
import { useSesion } from "../lib/sesion";
import { colores, estilos, fmtCajuelas, fmtFechaHora } from "./estilos";

/**
 * Todos los recibos del recibidor en la cosecha, sin importar de qué jornada sean.
 *
 * Tiene menú propio y no cuelga de la bitácora porque así es como se busca de verdad: el
 * recibidor se acuerda del número o del productor, no de en qué bitácora quedó. La
 * jornada sigue siendo el padre —el recibo se cuelga de una— pero eso es contabilidad
 * del día, no la forma de encontrar un recibo.
 */
export function RecibosScreen({
  onNuevo,
  onAbrir,
}: Readonly<{ onNuevo: () => void; onAbrir: (r: Recibo) => void }>) {
  const insets = useSafeAreaInsets();
  const recibidor = useSesion((s) => s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [recibos, setRecibos] = useState<Recibo[] | null>(null);
  const [busqueda, setBusqueda] = useState("");

  useEffect(() => {
    const sub = database
      .get<Recibo>("recibos")
      .query(
        Q.where("recibidor", recibidor ?? ""),
        Q.where("cosecha", cosecha ?? ""),
        // Los más nuevos arriba: se consulta lo recién emitido, no lo de la mañana.
        Q.sortBy("recibo", Q.desc)
      )
      .observe()
      .subscribe(setRecibos);
    return () => sub.unsubscribe();
  }, [recibidor, cosecha]);

  /**
   * Busca por número, nombre y cédula A LA VEZ.
   *
   * No se elige el campo antes de escribir porque el recibidor no siempre sabe cuál
   * tiene: a veces le dicen el número del papel, a veces el nombre, y a veces le muestran
   * la cédula. Un selector de campo obliga a acertar antes de buscar.
   *
   * Se comparan los tres sin acentos ni mayúsculas: "JIMENEZ" tiene que encontrar a
   * "JIMÉNEZ", y en un teclado de teléfono nadie pone la tilde.
   */
  const visibles = useMemo(() => {
    const t = normalizar(busqueda);
    if (!t) return recibos ?? [];
    return (recibos ?? []).filter((r) =>
      normalizar(`${r.recibo} ${r.nombre ?? ""} ${r.cedula ?? ""} ${r.codigo ?? ""}`).includes(t)
    );
  }, [recibos, busqueda]);

  const sinImprimir = (recibos ?? []).filter((r) => (r.impreso ?? 0) === 0).length;

  return (
    <View style={estilos.root}>
      {sinImprimir > 0 ? (
        // No es un adorno: un recibo sin imprimir no sincroniza, así que este número es
        // exactamente el trabajo que todavía sólo existe en este teléfono.
        <View
          style={{
            backgroundColor: "#fef3c7",
            paddingHorizontal: 16,
            paddingVertical: 8,
          }}
        >
          <Text style={{ color: "#92400e", fontSize: 13 }}>
            {sinImprimir} sin imprimir — no sincronizan hasta salir en papel
          </Text>
        </View>
      ) : null}

      <TextInput
        style={estilos.buscador}
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Buscar por número, nombre o cédula"
        placeholderTextColor={colores.textoTenue}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
      />

      <FlatList
        data={visibles}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Fila recibo={item} onPress={() => onAbrir(item)} />}
        ListEmptyComponent={
          recibos == null ? null : (
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>
                {busqueda.trim()
                  ? `Ningún recibo coincide con "${busqueda.trim()}".`
                  : "Todavía no hay recibos en esta cosecha."}
              </Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
      />

      <TouchableOpacity
        onPress={onNuevo}
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
          + Nuevo recibo
        </Text>
      </TouchableOpacity>
    </View>
  );
}

/**
 * Sin acentos y sin mayúsculas.
 *
 * Los acentos importan de verdad: en un teclado de teléfono nadie escribe la tilde, y sin
 * esto "JIMENEZ" no encontraría a "JIMÉNEZ".
 *
 * Los ceros de relleno del número no necesitan tratamiento: la comparación es por
 * subcadena, así que buscar "12" ya encuentra `063000012` — que es como el recibidor lo
 * recuerda, por el final y no por el prefijo del recibidor.
 */
function normalizar(t: string): string {
  // NFD separa la letra de su tilde, y el rango borra las marcas diacríticas sueltas.
  // Va escrito con \u y no con los caracteres literales: escritos tal cual, en el editor
  // se ven como un corchete vacío y cualquiera los borraría por accidente.
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function Fila({ recibo, onPress }: Readonly<{ recibo: Recibo; onPress: () => void }>) {
  const anulado = esAnulado(recibo);
  return (
    <TouchableOpacity onPress={onPress} style={estilos.fila}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <Text
          style={[
            estilos.filaTitulo,
            anulado ? { textDecorationLine: "line-through", color: colores.textoTenue } : null,
          ]}
        >
          {recibo.recibo}
        </Text>
        <Text style={estilos.filaTitulo}>
          {fmtCajuelas(recibo.rcantidad, recibo.rcantidadcuartillos)}
        </Text>
      </View>
      <Text style={estilos.filaSubtitulo} numberOfLines={1}>
        {recibo.nombre ?? recibo.codigo ?? "—"}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Estado recibo={recibo} anulado={anulado} />
        <Text style={estilos.filaSubtitulo}>{fmtFechaHora(recibo.fecha)}</Text>
      </View>
    </TouchableOpacity>
  );
}

/** El estado sale de `impreso`: 0 sin imprimir, 1 el original, 2+ copias. */
function Estado({ recibo, anulado }: Readonly<{ recibo: Recibo; anulado: boolean }>) {
  const impreso = recibo.impreso ?? 0;
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
    <View
      style={[estilos.badge, { backgroundColor: color, marginTop: 4 }]}
    >
      <Text style={estilos.badgeTexto}>{texto}</Text>
    </View>
  );
}
