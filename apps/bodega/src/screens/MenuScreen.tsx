import React from "react";
import { View, Text, Pressable, ScrollView, Alert, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuthStore } from "@erp/shared-api";
import { useSesion } from "../lib/sesion";
import { useOpciones } from "../lib/opciones";
import { useMedidas, Medidas } from "../lib/pantalla";
import type { Props } from "../lib/rutas";
import { VERDE } from "../branding";

/**
 * Menú principal, como el del legacy.
 *
 * Al principio no lo puse: el operario hace una sola cosa, y esconderla
 * detrás de un menú le agrega un toque a cada movimiento. Pero faltaban dos
 * cosas que no tienen otro lugar donde vivir —cerrar sesión para que entre
 * otro turno, y las opciones que todavía no existen— y sin ellas la app no se
 * puede usar en una bodega con varios operarios.
 *
 * LAS OPCIONES SALEN DE LOS PERMISOS DEL USUARIO, no de una lista fija. Se
 * piden a /api/ca/movil/opciones: lo que no tiene permitido no aparece.
 * Mostrarlo y que reviente con 403 al tocarlo enseña a la gente a ignorar los
 * errores. Y como el mapeo vive en el servidor, sumar una opción no obliga a
 * repartir un APK nuevo a cada tableta.
 *
 * Esconder un botón NO es un control de acceso: cada endpoint exige su permiso
 * por su cuenta. Esto es comodidad para el que usa la app.
 *
 * Lo que el usuario NO tiene permitido no se muestra: ahí la respuesta honesta
 * es que ese usuario no lo hace. Si en algún momento hay una opción con permiso
 * pero sin pantalla, va apagada y no escondida — verla en gris dice "todavía
 * no", que es la verdad; no verla diría "esta app no lo hace", que no lo es.
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
  const opciones = useOpciones((st) => st.opciones);
  const errorOpciones = useOpciones((st) => st.error);
  const cargandoOpciones = useOpciones((st) => st.cargando);
  const refrescarOpciones = useOpciones((st) => st.refrescar);
  const soltarBodega = useSesion((st) => st.soltarBodega);
  const cerrarSesion = useSesion((st) => st.cerrar);
  const logout = useAuthStore((st) => st.logout);
  const usuario = useAuthStore((st) => st.user);

  const columnas = m.columnas(m.ancho - bordes.left - bordes.right, 240);

  // Los permisos se releen CADA VEZ que se vuelve al menu, no solo al entrar.
  // Cambian del lado del servidor —se le suma un permiso a un rol, o se agrega
  // una opcion nueva— y la app no puede exigir que el operario cierre sesion
  // para enterarse. Ya paso: la opcion de OT quedo en solo lectura porque la
  // respuesta guardada era anterior a que existiera ca.ot.update.
  React.useEffect(
    () => navigation.addListener("focus", () => { void refrescarOpciones(); }),
    [navigation, refrescarOpciones],
  );

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

  const items: Opcion[] = [];

  if (opciones.cambioUbicacion.mover || opciones.cambioUbicacion.ver) {
    items.push({
      clave: "cambio",
      titulo: "Cambio de ubicación",
      detalle: "Mover una partida a otra ubicación de la bodega",
      color: VERDE,
      activa: true,
      alTocar: () => navigation.navigate("Buscar"),
    });
  }

  if (opciones.tomaFisica.ver) {
    items.push({
      clave: "toma",
      titulo: "Toma física",
      detalle: "Contar el inventario de la bodega",
      color: "#0e7490",
      activa: true,
      alTocar: () => navigation.navigate("TomaFisica"),
    });
  }

  if (opciones.ot.ver) {
    items.push({
      clave: "ot",
      titulo: "Estado de OT",
      detalle: "Marcar avance de las órdenes abiertas",
      color: "#7c3aed",
      activa: true,
      alTocar: () => navigation.navigate("Ot"),
    });
  }

  items.push(...[
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
  ]);

  // Sin permisos verificados el menú queda con lo que no los necesita. Se dice
  // por qué y se ofrece reintentar: así el operario entiende que le falta
  // conexión y no que le quitaron el acceso.
  const aviso = cargandoOpciones
    ? "Leyendo permisos…"
    : errorOpciones
      ? `No se pudieron leer los permisos: ${errorOpciones}`
      : null;

  return (
    <ScrollView
      contentContainerStyle={[
        s.rejilla,
        { paddingLeft: m.e(6) + bordes.left, paddingRight: m.e(6) + bordes.right },
      ]}
    >
      {aviso && (
        <View style={[s.celda, { width: "100%" }]}>
          <Pressable style={s.aviso} onPress={() => void refrescarOpciones()} disabled={cargandoOpciones}>
            <Text style={s.avisoTexto}>{aviso}</Text>
            {!cargandoOpciones && <Text style={s.avisoAccion}>Tocá para reintentar</Text>}
          </Pressable>
        </View>
      )}
      {items.map((o) => (
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
    aviso: {
      backgroundColor: "#fef3c7", borderColor: "#fcd34d", borderWidth: 1,
      borderRadius: 10, padding: m.e(12), minHeight: m.t(56), justifyContent: "center",
    },
    avisoTexto: { fontSize: m.e(14), color: "#92400e" },
    avisoAccion: { fontSize: m.e(13), color: "#b45309", fontWeight: "700", marginTop: m.e(2) },
  });
}
