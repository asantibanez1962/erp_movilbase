import React from "react";
import { View, Text, Pressable, ScrollView, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "@erp/shared-api";
import { useSesion } from "../lib/sesion";
import { useMedidas, Medidas } from "../lib/pantalla";
import type { Props } from "../lib/rutas";
import { VERDE } from "./BuscarScreen";

/**
 * Menú principal, como el del legacy.
 *
 * Al principio no lo puse: el operario hace una sola cosa, y esconderla
 * detrás de un menú le agrega un toque a cada movimiento. Pero faltaban dos
 * cosas que no tienen otro lugar donde vivir —cerrar sesión para que entre
 * otro turno, y las opciones que todavía no existen— y sin ellas la app no se
 * puede usar en una bodega con varios operarios.
 *
 * LO QUE FALTA SE MUESTRA APAGADO, NO ESCONDIDO. "Toma Física" y "Estado de
 * OT" están en el legacy y el operario los va a buscar. Verlos en gris dice
 * "todavía no", que es la verdad; no verlos dice "esta app no lo hace", que
 * no lo es.
 */

interface Opcion {
  clave: string;
  titulo: string;
  detalle: string;
  color: string;
  activa: boolean;
  alTocar?: () => void;
}

export function MenuScreen({ navigation }: Readonly<Props<"Menu">>) {
  const m = useMedidas();
  const s = React.useMemo(() => crearEstilos(m), [m]);
  const bordes = useSafeAreaInsets();

  const nombreBodega = useSesion((st) => st.nombreBodega);
  const soltarBodega = useSesion((st) => st.soltarBodega);
  const cerrarSesion = useSesion((st) => st.cerrar);
  const logout = useAuthStore((st) => st.logout);
  const usuario = useAuthStore((st) => st.user);

  const columnas = m.columnas(m.ancho - bordes.left - bordes.right, 240);

  function salir() {
    Alert.alert(
      "Cerrar sesión",
      "Va a entrar otro usuario. No se pierde nada: esta app no guarda movimientos en el aparato.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Cerrar sesión",
          style: "destructive",
          onPress: () => {
            // Los dos: cerrar() borra los tokens y la bodega, logout() es el
            // que baja isAuthenticated y devuelve la app al login. Sin el
            // segundo la sesión queda vacía pero la app cree que sigue dentro.
            void cerrarSesion().then(() => logout());
          },
        },
      ],
    );
  }

  const opciones: Opcion[] = [
    {
      clave: "cambio",
      titulo: "Cambio de ubicación",
      detalle: "Mover una partida a otra ubicación de la bodega",
      color: VERDE,
      activa: true,
      alTocar: () => navigation.navigate("Buscar"),
    },
    {
      clave: "toma",
      titulo: "Toma física",
      detalle: "Todavía no disponible",
      color: "#94a3b8",
      activa: false,
    },
    {
      clave: "ot",
      titulo: "Estado de OT",
      detalle: "Todavía no disponible",
      color: "#94a3b8",
      activa: false,
    },
    {
      clave: "bodega",
      titulo: "Cambiar de bodega",
      detalle: nombreBodega ?? "Sin bodega",
      color: "#0f766e",
      activa: true,
      alTocar: () => void soltarBodega(),
    },
    {
      clave: "servidor",
      titulo: "Servidor",
      detalle: "Dirección del sistema",
      color: "#475569",
      activa: true,
      alTocar: () => navigation.navigate("Servidor"),
    },
    {
      clave: "salir",
      titulo: "Cerrar sesión",
      detalle: usuario?.usuario ?? "",
      color: "#b91c1c",
      activa: true,
      alTocar: salir,
    },
  ];

  return (
    <ScrollView
      contentContainerStyle={[
        s.rejilla,
        { paddingLeft: m.e(6) + bordes.left, paddingRight: m.e(6) + bordes.right },
      ]}
    >
      {opciones.map((o) => (
        <View key={o.clave} style={[s.celda, { width: `${100 / columnas}%` }]}>
          <Pressable
            style={[s.tarjeta, !o.activa && s.tarjetaApagada]}
            onPress={o.alTocar}
            disabled={!o.activa}
          >
            <View style={[s.barra, { backgroundColor: o.color }]} />
            <Text style={[s.titulo, !o.activa && s.textoApagado]} numberOfLines={2}>
              {o.titulo}
            </Text>
            <Text style={s.detalle} numberOfLines={2}>{o.detalle}</Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

function crearEstilos(m: Medidas) {
  return StyleSheet.create({
    rejilla: {
      flexDirection: "row", flexWrap: "wrap",
      paddingVertical: m.e(8), backgroundColor: "#f8fafc",
    },
    celda: { padding: m.e(6) },
    tarjeta: {
      minHeight: m.t(96), justifyContent: "center",
      backgroundColor: "#fff", padding: m.e(14), paddingLeft: m.e(18), borderRadius: 10,
      borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden",
    },
    tarjetaApagada: { backgroundColor: "#f1f5f9" },
    // Franja de color al canto: distingue una opción de otra de un vistazo,
    // sin obligar a leer el título.
    barra: { position: "absolute", left: 0, top: 0, bottom: 0, width: m.e(6) },
    titulo: { fontSize: m.e(19), fontWeight: "700", color: "#0f172a" },
    textoApagado: { color: "#64748b" },
    detalle: { fontSize: m.e(13), color: "#64748b", marginTop: m.e(3) },
  });
}
