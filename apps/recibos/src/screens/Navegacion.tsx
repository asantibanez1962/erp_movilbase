import { useState } from "react";
import { Alert, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  DarkTheme,
  DefaultTheme,
  DrawerActions,
  NavigationContainer,
  type Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from "@react-navigation/drawer";
import { useAuthStore } from "@erp/shared-api";
import { describirFallos } from "@erp/shared-sync";
import type { Bitacora } from "../db/models";
import { cliente } from "../branding";
import { cerrarSesion, cambiarRecibidor } from "../lib/alcance";
import { describirPendientes, resumenPendientes, syncNow } from "../lib/sync";
import { useSesion } from "../lib/sesion";
import { BitacorasScreen } from "./BitacorasScreen";
import { AbrirBitacoraScreen } from "./AbrirBitacoraScreen";
import { BitacoraScreen } from "./BitacoraScreen";
import { ServidorScreen } from "./ServidorScreen";

/**
 * Navegación: drawer + stack, el mismo esquema ya revisado y aprobado en promotor.
 *
 * `cliente.chrome` no es el color de marca crudo sino su versión oscurecida hasta que el
 * texto claro alcanza 4.5:1 — con el verde de Altura tal cual, el título del header
 * quedaba en 2.6:1 y no se leía al sol.
 */
const navTheme: Theme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    background: "#f8fafc",
    card: cliente.chrome,
    text: "#f1f5f9",
    primary: "#3b82f6",
    border: "#1e293b",
    notification: "#3b82f6",
  },
  fonts: DarkTheme.fonts,
};

export type StackParams = {
  Jornadas: undefined;
  AbrirJornada: undefined;
  // La bitácora viaja como INSTANCIA de WatermelonDB y no como un id: es observable, así
  // que la pantalla se entera sola cuando se le agrega un recibo o se cierra. Con un id
  // habría que volver a buscarla y suscribirse a mano en cada entrada.
  Jornada: { bitacora: Bitacora };
};

const Stack = createNativeStackNavigator<StackParams>();

function BotonMenu({ navigation }: Readonly<{ navigation: any }>) {
  return (
    <TouchableOpacity
      onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ color: "#f1f5f9", fontSize: 26, lineHeight: 28 }}>≡</Text>
    </TouchableOpacity>
  );
}

function JornadasStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: cliente.chrome },
        headerTintColor: "#f1f5f9",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Stack.Screen
        name="Jornadas"
        options={({ navigation }) => ({
          title: "Jornadas",
          headerLeft: () => <BotonMenu navigation={navigation} />,
        })}
      >
        {({ navigation }) => (
          <BitacorasScreen
            onAbrir={() => navigation.navigate("AbrirJornada")}
            onEntrar={(b) => navigation.navigate("Jornada", { bitacora: b })}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="AbrirJornada" options={{ title: "Abrir jornada" }}>
        {({ navigation }) => (
          <AbrirBitacoraScreen
            // replace: la pantalla de apertura no tiene sentido en el historial. Si
            // quedara, el "atrás" desde la jornada recién creada volvería a un
            // formulario que ya se usó.
            onListo={(b) => navigation.replace("Jornada", { bitacora: b })}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Jornada" options={{ title: "Jornada" }}>
        {({ navigation, route }) => (
          <BitacoraScreen
            bitacora={route.params.bitacora}
            onVolver={() => navigation.navigate("Jornadas")}
            onNuevoRecibo={() =>
              Alert.alert(
                "Todavía no",
                "La pantalla de recibo es el paso siguiente. La jornada ya se puede " +
                  "abrir, ver y cerrar."
              )
            }
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

const Drawer = createDrawerNavigator();

export function Navegacion() {
  return (
    <NavigationContainer theme={navTheme}>
      <Drawer.Navigator
        drawerContent={(props) => <ContenidoDrawer {...props} />}
        screenOptions={{
          // El header visible es el del Stack; el drawer no rendera el suyo para no
          // apilar dos. El hamburguesa vive en el Stack.
          headerShown: false,
          drawerStyle: { backgroundColor: cliente.chrome },
        }}
      >
        <Drawer.Screen name="Main" component={JornadasStack} />
        <Drawer.Screen
          name="Servidor"
          component={ServidorScreen}
          options={{
            headerShown: true,
            title: "Servidor",
            headerStyle: { backgroundColor: cliente.chrome },
            headerTintColor: "#f1f5f9",
          }}
        />
      </Drawer.Navigator>
    </NavigationContainer>
  );
}

function ContenidoDrawer(props: DrawerContentComponentProps) {
  const user = useAuthStore((s) => s.user);
  const recibidor = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);

  const sincronizar = async () => {
    if (sincronizando) return;
    setSincronizando(true);
    setUltimoError(null);
    try {
      // Desde que el sync es resiliente, las colecciones que no se pudieron traer VUELVEN
      // acá en vez de tirar: las demás ya se aplicaron. Que falle una parte no es lo mismo
      // que no haber sincronizado, y decírselo igual haría desconfiar de un sync que sí
      // sirvió.
      const fallos = await syncNow();
      if (fallos.length > 0) {
        setUltimoError(`Sincronizado, pero sin traer: ${describirFallos(fallos)}`);
      }
    } catch (e) {
      setUltimoError((e as Error)?.message ?? "Error de conexión");
    } finally {
      setSincronizando(false);
    }
  };

  /**
   * Las dos salidas borran la base local. Primero se dice QUÉ se pierde —la lista, no un
   * número— y recién ahí se pide la confirmación destructiva: un número no alcanza para
   * decidir si vale la pena descartar el trabajo de una mañana.
   */
  const salir = async (
    accion: (o: { descartar: boolean }) => Promise<void>,
    titulo: string
  ) => {
    setUltimoError(null);
    const ejecutar = (descartar: boolean) =>
      accion({ descartar }).catch((e: Error) => setUltimoError(e.message));

    const pendientes = await resumenPendientes();
    if (pendientes.total === 0) {
      Alert.alert(
        titulo,
        "Se borran los datos de este teléfono: pertenecen a tu usuario y a tu recibidor. " +
          "No hay nada sin enviar, así que no se pierde trabajo.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: titulo, style: "destructive", onPress: () => void ejecutar(false) },
        ]
      );
      return;
    }

    Alert.alert(
      "Hay trabajo sin enviar",
      `Todavía no subieron: ${describirPendientes(pendientes)}.\n\n` +
        "Se borran los datos de este teléfono y ESO SE PIERDE. Cerrá la jornada e " +
        "imprimila primero.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Salir y descartar",
          style: "destructive",
          onPress: () => void ejecutar(true),
        },
      ]
    );
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={estilosDrawer.contenido}>
      <View style={estilosDrawer.header}>
        {cliente.logo ? (
          <Image
            source={cliente.logo}
            style={estilosDrawer.logo}
            resizeMode="contain"
            accessibilityLabel={cliente.nombreLargo}
          />
        ) : (
          <Text style={estilosDrawer.titulo}>{cliente.nombre}</Text>
        )}
        {user ? <Text style={estilosDrawer.tenue}>{user.usuario}</Text> : null}
        {/* Contexto siempre visible: sin esto no se sabe por qué no aparece un
            productor que se espera. */}
        <Text style={estilosDrawer.tenue}>
          {recibidor ?? "—"} · Cosecha {cosecha ?? "—"}
        </Text>
      </View>

      {/* El error va ARRIBA de las acciones: lo escriben todas, y puesto debajo de una
          parecía de esa. */}
      {ultimoError ? (
        <View style={estilosDrawer.errorCaja}>
          <Text style={estilosDrawer.error}>⚠ {ultimoError}</Text>
        </View>
      ) : null}

      <DrawerItem
        label={sincronizando ? "Sincronizando..." : "Sincronizar"}
        onPress={sincronizar}
        labelStyle={estilosDrawer.label}
      />

      {/* Cada beneficio corre su backend en su red. Sin esta entrada, un cambio de IP
          obligaría a recompilar el APK e instalarlo teléfono por teléfono. */}
      <DrawerItem
        label="Servidor"
        onPress={() => props.navigation.navigate("Servidor")}
        labelStyle={estilosDrawer.label}
      />

      {/* Agrupadas y separadas del resto: las de arriba son inocuas y éstas cuestan
          bajar todo de nuevo. Mezcladas, un toque errado con una mano sale caro. */}
      <View style={estilosDrawer.separador}>
        <Text style={estilosDrawer.seccion}>Borra los datos del teléfono</Text>
      </View>

      <DrawerItem
        label="Cambiar recibidor"
        onPress={() => void salir(cambiarRecibidor, "Cambiar recibidor")}
        labelStyle={estilosDrawer.label}
      />
      <DrawerItem
        label="Cerrar sesión"
        onPress={() => void salir(cerrarSesion, "Cerrar sesión")}
        labelStyle={estilosDrawer.label}
      />
    </DrawerContentScrollView>
  );
}

const estilosDrawer = StyleSheet.create({
  contenido: { paddingTop: 24 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    marginBottom: 12,
  },
  titulo: { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  /**
   * Fondo blanco a propósito: ninguno de los logos que mandó el cliente viene con
   * transparencia, así que sobre el drawer oscuro aparecería igual un rectángulo claro.
   * Con padding y esquinas redondeadas se lee como una placa de marca y no como un error
   * de recorte.
   */
  logo: {
    width: 176,
    height: 68,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  tenue: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
  label: { color: "#e2e8f0" },
  separador: {
    borderTopWidth: 1,
    borderTopColor: "#334155",
    marginTop: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  seccion: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  errorCaja: {
    backgroundColor: "#7f1d1d",
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderRadius: 8,
  },
  error: { color: "#fecaca", fontSize: 12 },
});
