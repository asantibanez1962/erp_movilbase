import { useEffect, useMemo, useState } from "react";
import { FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Q } from "@nozbe/watermelondb";
import type { Remedida } from "../db/models";
import { cliente } from "../branding";
import { database } from "../lib/db";
import { esAnulada, partir } from "../lib/remedida";
import { useSesion } from "../lib/sesion";
import {
  DIAS_POR_DEFECTO,
  desdeCuando,
  FiltroDias,
  MarcaEnviado,
  type Dias,
} from "./FiltroDias";
import { colores, estilos, fmtCajuelas, fmtFecha } from "./estilos";

/**
 * Las remedidas de la cosecha, la más nueva primero.
 *
 * Se busca por número, placa y sifón: cuando alguien pregunta por una remedida dice el
 * número del papel o la placa del camión, no la fecha.
 */
export function RemedidasScreen({
  onNueva,
  onAbrir,
}: Readonly<{ onNueva: () => void; onAbrir: (r: Remedida) => void }>) {
  const insets = useSafeAreaInsets();
  const cosecha = useSesion((s) => s.cosecha);
  const [remedidas, setRemedidas] = useState<Remedida[] | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [dias, setDias] = useState<Dias>(DIAS_POR_DEFECTO);
  // Ver la nota en RecibosScreen: `_status` no se puede observar, así que el aviso de
  // fin de sync es lo que hace aparecer la marca "Enviado".
  const syncTick = useSesion((s) => s.syncTick);

  useEffect(() => {
    const sub = database
      .get<Remedida>("remedidas")
      .query(Q.where("cosecha", cosecha ?? ""), Q.sortBy("recibo", Q.desc))
      // ⚠️ `observeWithColumns` y no `observe`: éste sólo avisa cuando cambia el conjunto
      // de filas, no cuando cambia un campo de una que ya estaba. Imprimir es lo segundo,
      // así que la lista se quedaba en SIN IMPRIMIR. Ver la nota larga en RecibosScreen.
      .observeWithColumns([
        "impreso",
        "observaciones", // de acá sale ANULADA
        "recibo",
        "cantidad",
        "placa",
        "sifon",
        "fecha",
      ])
      .subscribe(setRemedidas);
    return () => sub.unsubscribe();
  }, [cosecha, syncTick]);

  const visibles = useMemo(() => {
    const desde = desdeCuando(dias);
    const enRango =
      desde == null
        ? (remedidas ?? [])
        : (remedidas ?? []).filter((r) => (r.fecha ?? 0) >= desde);

    const t = busqueda.trim().toLowerCase();
    if (!t) return enRango;
    return enRango.filter((r) =>
      `${r.recibo} ${r.placa ?? ""} ${r.sifon}`.toLowerCase().includes(t)
    );
  }, [remedidas, busqueda, dias]);

  const sinImprimir = visibles.filter((r) => (r.impreso ?? 0) === 0).length;

  return (
    <View style={estilos.root}>
      {sinImprimir > 0 ? (
        <View
          style={{ backgroundColor: "#fef3c7", paddingHorizontal: 16, paddingVertical: 8 }}
        >
          <Text style={{ color: "#92400e", fontSize: 13 }}>
            {sinImprimir} sin imprimir — no sincronizan hasta salir en papel
          </Text>
        </View>
      ) : null}

      <FiltroDias valor={dias} onCambiar={setDias} cuantas={visibles.length} />

      <TextInput
        style={estilos.buscador}
        value={busqueda}
        onChangeText={setBusqueda}
        placeholder="Buscar por número, placa o sifón"
        placeholderTextColor={colores.textoTenue}
        autoCorrect={false}
        autoCapitalize="none"
      />

      <FlatList
        data={visibles}
        keyExtractor={(r) => r.id}
        renderItem={({ item }) => <Fila remedida={item} onPress={() => onAbrir(item)} />}
        ListEmptyComponent={
          remedidas == null ? null : (
            <View style={estilos.vacio}>
              <Text style={estilos.vacioTexto}>
                {busqueda.trim()
                  ? "Ninguna remedida coincide."
                  : dias === 1
                    ? "Todavía no hay remedidas hoy. Tocá «Todo» para ver las anteriores."
                    : dias == null
                      ? "Todavía no hay remedidas en esta cosecha."
                      : `No hay remedidas en los últimos ${dias} días.`}
              </Text>
            </View>
          )
        }
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
      />

      <TouchableOpacity
        onPress={onNueva}
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
          + Nueva remedida
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function Fila({
  remedida,
  onPress,
}: Readonly<{ remedida: Remedida; onPress: () => void }>) {
  const anulada = esAnulada(remedida);
  const { cajuelas, cuartillos } = partir(remedida.cantidad);
  return (
    <TouchableOpacity onPress={onPress} style={estilos.fila}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
        <Text
          style={[
            estilos.filaTitulo,
            anulada
              ? { textDecorationLine: "line-through", color: colores.textoTenue }
              : null,
          ]}
        >
          {remedida.recibo}
        </Text>
        <Text style={estilos.filaTitulo}>{fmtCajuelas(cajuelas, cuartillos)}</Text>
      </View>
      <Text style={estilos.filaSubtitulo}>
        {[remedida.placa, `sifón ${remedida.sifon}`].filter(Boolean).join(" · ")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Estado remedida={remedida} anulada={anulada} />
        <Text style={estilos.filaSubtitulo}>{fmtFecha(remedida.fecha)}</Text>
        <MarcaEnviado enviado={remedida.syncStatus === "synced"} />
      </View>
    </TouchableOpacity>
  );
}

/** Igual que el recibo: el estado sale de `impreso`. */
function Estado({
  remedida,
  anulada,
}: Readonly<{ remedida: Remedida; anulada: boolean }>) {
  const impreso = remedida.impreso ?? 0;
  let texto: string;
  let color: string;
  if (anulada) {
    texto = "ANULADA";
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
    <View style={[estilos.badge, { backgroundColor: color, marginTop: 4 }]}>
      <Text style={estilos.badgeTexto}>{texto}</Text>
    </View>
  );
}
