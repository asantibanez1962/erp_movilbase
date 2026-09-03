import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  NavigationContainer,
  DefaultTheme,
  DrawerActions,
  Theme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import {
  createDrawerNavigator,
  DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
} from "@react-navigation/drawer";
import { Alert, Image } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "./src/branding";
import { LoginScreen } from "./src/screens/LoginScreen";
import { ContextoScreen } from "./src/screens/ContextoScreen";
import { CambiarClaveScreen } from "./src/screens/CambiarClaveScreen";
import { useSesion } from "./src/lib/sesion";
import { cambiarCosecha, contarPendientes, HayPendientesError, useSyncEstado } from "./src/lib/sync";
import { cargarContexto } from "./src/lib/contexto";
import {
  describirPendientes,
  rebajarTodo,
  resumenPendientes,
} from "./src/lib/rebajar";
import { cerrarSesion, verificarAlcance } from "./src/lib/alcance";
import { describirFallos } from "@erp/shared-sync";
import { COLLECTIONS } from "./src/db/schema";
import { PickerModal } from "./src/screens/componentes/Picker";
import { usePendientes } from "./src/screens/usePendientes";
import { ProductoresScreen } from "./src/screens/ProductoresScreen";
import { ProductorDetailScreen } from "./src/screens/ProductorDetailScreen";
import { SolicitudesScreen } from "./src/screens/SolicitudesScreen";
import { SolicitudDetailScreen } from "./src/screens/SolicitudDetailScreen";
import { NuevaSolicitudScreen } from "./src/screens/NuevaSolicitudScreen";
import { VisitasScreen } from "./src/screens/VisitasScreen";
import { VisitaDetailScreen } from "./src/screens/VisitaDetailScreen";
import { NuevaVisitaScreen } from "./src/screens/NuevaVisitaScreen";
import { AdjuntosScreen } from "./src/screens/AdjuntosScreen";
import { BitacoraScreen } from "./src/screens/BitacoraScreen";
import { ServidorScreen } from "./src/screens/ServidorScreen";
import { bootstrapApi } from "./src/lib/api";
import { syncNow } from "./src/lib/sync";

/**
 * El chrome (header, tab bar, drawer) lleva el color del cliente; el resto de la
 * paleta —botones, acentos, labels del menú— queda como estaba, según se pidió.
 *
 * `cliente.chrome` no es el color de marca crudo sino su versión oscurecida hasta
 * que el texto claro alcanza 4.5:1 de contraste. Ver src/branding: con el verde de
 * Café Altura tal cual, el título del header quedaba en 2.6:1 y no se leía al sol.
 * Para el perfil de desarrollo da el mismo navy de siempre.
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
  fonts: DefaultTheme.fonts,
};

const stackScreenOptions = {
  headerStyle: { backgroundColor: cliente.chrome },
  headerTintColor: "#f1f5f9",
} as const;

/**
 * Botón hamburguesa que abre el drawer. Se usa como headerLeft de la pantalla
 * raíz de cada Stack (en pantallas profundas el Stack pone el back automático).
 * Carácter unicode para no depender de @expo/vector-icons.
 */
function DrawerMenuButton({ navigation }: Readonly<{ navigation: any }>) {
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

/** "+" del header para crear. Mismo hitSlop generoso que el hamburguesa. */
function BotonNuevo({ onPress }: Readonly<{ onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 4 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ color: "#f1f5f9", fontSize: 30, lineHeight: 32 }}>+</Text>
    </TouchableOpacity>
  );
}

// ─── Stacks por tab ──────────────────────────────────────────────────

const ProductoresStack = createNativeStackNavigator();
function ProductoresStackScreens() {
  return (
    <ProductoresStack.Navigator screenOptions={stackScreenOptions}>
      <ProductoresStack.Screen
        name="ProductoresList"
        component={ProductoresScreen}
        options={({ navigation }) => ({
          title: "Productores",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
        })}
      />
      <ProductoresStack.Screen
        name="ProductorDetail"
        component={ProductorDetailScreen}
        options={{ title: "Productor" }}
      />
      {/* La misma pantalla genérica de adjuntos que usan solicitudes y visitas:
          recibe colección + id del registro. Acá son las fotos del productor. */}
      <ProductoresStack.Screen
        name="Adjuntos"
        component={AdjuntosScreen}
        options={{ title: "Fotos del productor" }}
      />
    </ProductoresStack.Navigator>
  );
}

const SolicitudesStack = createNativeStackNavigator();
function SolicitudesStackScreens() {
  return (
    <SolicitudesStack.Navigator screenOptions={stackScreenOptions}>
      <SolicitudesStack.Screen
        name="SolicitudesList"
        component={SolicitudesScreen}
        options={({ navigation }) => ({
          title: "Solicitudes",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
          headerRight: () => (
            <BotonNuevo onPress={() => navigation.navigate("NuevaSolicitud")} />
          ),
        })}
      />
      <SolicitudesStack.Screen
        name="SolicitudDetail"
        component={SolicitudDetailScreen}
        options={{ title: "Solicitud" }}
      />
      <SolicitudesStack.Screen
        name="NuevaSolicitud"
        component={NuevaSolicitudScreen}
        options={({ route }) => ({
          title: (route.params as { solicitudId?: string })?.solicitudId
            ? "Editar solicitud"
            : "Nueva solicitud",
        })}
      />
      {/* La misma pantalla de adjuntos que en visitas: acá para la cédula y los
          respaldos de la solicitud. */}
      <SolicitudesStack.Screen
        name="Adjuntos"
        component={AdjuntosScreen}
        options={{ title: "Adjuntos de la solicitud" }}
      />
    </SolicitudesStack.Navigator>
  );
}

const VisitasStack = createNativeStackNavigator();
function VisitasStackScreens() {
  return (
    <VisitasStack.Navigator screenOptions={stackScreenOptions}>
      <VisitasStack.Screen
        name="VisitasList"
        component={VisitasScreen}
        options={({ navigation }) => ({
          title: "Visitas",
          headerLeft: () => <DrawerMenuButton navigation={navigation} />,
          headerRight: () => (
            <BotonNuevo onPress={() => navigation.navigate("NuevaVisita")} />
          ),
        })}
      />
      <VisitasStack.Screen
        name="VisitaDetail"
        component={VisitaDetailScreen}
        options={{ title: "Visita" }}
      />
      <VisitasStack.Screen
        name="NuevaVisita"
        component={NuevaVisitaScreen}
        // El título depende de si viene con visitaId: la misma pantalla sirve
        // para crear y para editar.
        options={({ route }) => ({
          title: (route.params as { visitaId?: string })?.visitaId
            ? "Editar visita"
            : "Nueva visita",
        })}
      />
      <VisitasStack.Screen
        name="Adjuntos"
        component={AdjuntosScreen}
        options={{ title: "Fotos de la visita" }}
      />
    </VisitasStack.Navigator>
  );
}

// ─── Bottom tabs ─────────────────────────────────────────────────────

/**
 * Ícono de un tab.
 *
 * @expo/vector-icons ya viene con Expo, así que esto no suma dependencia. Se usa acá
 * y no los caracteres unicode del drawer porque un tab necesita dos estados visuales
 * (activo/inactivo) y un tamaño estable: un emoji cambia de forma entre fabricantes y
 * no toma el color del tema.
 *
 * Los tres elegidos dicen QUÉ hay adentro, no una metáfora: personas para el padrón de
 * productores, un documento que se edita para las solicitudes, y un punto en el mapa
 * para las visitas — que es literalmente lo que la visita captura.
 */
function iconoTab(nombre: React.ComponentProps<typeof MaterialCommunityIcons>["name"]) {
  return ({ color, size }: { color: string; size: number }) => (
    <MaterialCommunityIcons name={nombre} size={size} color={color} />
  );
}

const Tabs = createBottomTabNavigator();
function MainTabs() {
  // El inset es el alto de la barra de gestos/navegación del SO. Sin sumarlo,
  // los labels quedan tapados en teléfonos con gesture nav. Misma corrección
  // que se hizo en recibos-cr.
  const insets = useSafeAreaInsets();
  const TAB_BAR_CONTENT_HEIGHT = 56;
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: cliente.chrome,
          borderTopColor: "#1e293b",
          height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 14, fontWeight: "600" },
        tabBarActiveTintColor: cliente.acento,
        tabBarInactiveTintColor: "#94a3b8",
      }}
    >
      <Tabs.Screen
        name="ProductoresTab"
        component={ProductoresStackScreens}
        options={{ tabBarLabel: "Productores", tabBarIcon: iconoTab("account-group") }}
      />
      <Tabs.Screen
        name="SolicitudesTab"
        component={SolicitudesStackScreens}
        options={{ tabBarLabel: "Solicitudes", tabBarIcon: iconoTab("file-document-edit") }}
      />
      <Tabs.Screen
        name="VisitasTab"
        component={VisitasStackScreens}
        options={{ tabBarLabel: "Visitas", tabBarIcon: iconoTab("map-marker-check") }}
      />
    </Tabs.Navigator>
  );
}

// ─── Drawer ──────────────────────────────────────────────────────────

/**
 * Etiqueta del botón de sincronizar.
 *
 * Separa "sin enviar" de "sin cerrar" porque son dos situaciones distintas para el
 * usuario: lo primero se resuelve sincronizando, lo segundo no —esa fila espera un
 * evento de negocio, como imprimir un recibo—. Con un solo número, sincroniza, el
 * contador no baja a cero y no se entiende por qué.
 */
function etiquetaSync(p: { porEnviar: number; retenidas: number; total: number }): string {
  if (p.total === 0) return "Sincronizar todo";
  const partes: string[] = [];
  if (p.porEnviar > 0) partes.push(`${p.porEnviar} sin enviar`);
  if (p.retenidas > 0) partes.push(`${p.retenidas} sin cerrar`);
  return `Sincronizar (${partes.join(" · ")})`;
}

/** Zonas por nombre ("MIRAMAR"), con el código como respaldo si falta el nombre. */
function descripcionZonas(
  todas: boolean,
  codigos: string[],
  nombres: string[]
): string {
  if (todas) return "todas las zonas";
  const etiquetas = nombres.length > 0 ? nombres : codigos;
  return etiquetas.length > 0 ? `zona(s) ${etiquetas.join(", ")}` : "sin zonas";
}

function CustomDrawer(props: DrawerContentComponentProps) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const cosecha = useSesion((s) => s.cosecha);
  const zonas = useSesion((s) => s.zonas);
  const zonasNombres = useSesion((s) => s.zonasNombres);
  const todasLasZonas = useSesion((s) => s.todasLasZonas);
  const companyId = useSesion((s) => s.companyId);
  const pendientes = usePendientes();
  const [syncing, setSyncing] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);
  const [cosechas, setCosechas] = useState<string[]>([]);
  const [pickerCosecha, setPickerCosecha] = useState(false);
  const [cambiando, setCambiando] = useState(false);
  const [rebajando, setRebajando] = useState(false);

  /**
   * Cambiar de cosecha rebaja los datos (ver cambiarCosecha), así que se avisa
   * antes y se bloquea si hay trabajo sin sincronizar en vez de perderlo.
   */
  const abrirCambioCosecha = async () => {
    setUltimoError(null);
    const pendientes = await contarPendientes();
    if (pendientes > 0) {
      Alert.alert(
        "Hay trabajo sin sincronizar",
        `Tenés ${pendientes} registro(s) que todavía no subieron. Sincronizá primero: al cambiar de cosecha se vuelven a bajar los datos y se perderían.`
      );
      return;
    }
    try {
      const { empresas } = await cargarContexto();
      const actual = empresas.find((e) => e.id === companyId);
      setCosechas((actual?.cosechas ?? []).map((c) => c.codigo));
      setPickerCosecha(true);
    } catch {
      setUltimoError(
        "No se pudo traer el catálogo de cosechas; se necesita conexión para cambiarla."
      );
    }
  };

  const aplicarCosecha = async (nueva: string) => {
    if (nueva === cosecha) return;
    setCambiando(true);
    setUltimoError(null);
    try {
      await cambiarCosecha(nueva);
    } catch (e) {
      setUltimoError(
        e instanceof HayPendientesError
          ? e.message
          : ((e as Error)?.message ?? "No se pudo cambiar la cosecha")
      );
    } finally {
      setCambiando(false);
    }
  };

  /**
   * Rebajar todos los datos: borrar la base local y traerla completa del servidor.
   *
   * Válvula de escape para cuando el cache queda en un estado que no se arregla
   * sincronizando — antes la única salida era desinstalar la app.
   *
   * DOS PASOS A PROPÓSITO. Primero se intenta subir lo pendiente; si algo queda, se
   * muestra QUÉ se va a perder (la lista, no un número) y recién ahí se pide la
   * confirmación destructiva. Un número no alcanza para decidir si vale la pena
   * descartar el trabajo de una mañana.
   */
  const rebajarDatos = async () => {
    if (rebajando) return;
    setUltimoError(null);

    const pendientes = await resumenPendientes();

    if (pendientes.total === 0) {
      Alert.alert(
        "Rebajar todos los datos",
        "Se borran los datos de este teléfono y se vuelven a bajar del servidor. " +
          "No hay nada sin enviar, así que no se pierde trabajo.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Rebajar", onPress: () => void ejecutarRebajado(false) },
        ]
      );
      return;
    }

    // Hay pendientes: aviso con el desglose, y la confirmación destructiva aparte.
    Alert.alert(
      "Hay trabajo sin enviar",
      `Todavía no subieron: ${describirPendientes(pendientes)}.\n\n` +
        "Si rebajás los datos ahora, ESO SE PIERDE y no se puede recuperar. " +
        "Conviene intentar sincronizar primero.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Descartar y rebajar",
          style: "destructive",
          onPress: () =>
            Alert.alert(
              "Confirmar",
              `Se van a descartar ${describirPendientes(pendientes)}. ¿Seguro?`,
              [
                { text: "No", style: "cancel" },
                {
                  text: "Sí, descartar",
                  style: "destructive",
                  onPress: () => void ejecutarRebajado(true),
                },
              ]
            ),
        },
      ]
    );
  };

  const ejecutarRebajado = async (descartar: boolean) => {
    setRebajando(true);
    setUltimoError(null);
    try {
      await rebajarTodo({ descartar });
    } catch (e) {
      setUltimoError((e as Error)?.message ?? "No se pudieron rebajar los datos");
    } finally {
      setRebajando(false);
    }
  };

  /**
   * Cerrar sesión de verdad: credenciales, contexto Y datos locales.
   *
   * Borra la base porque el cache pertenece a un usuario y a su alcance. Si quedara, el
   * próximo que entre heredaría empresa, cosecha y los productores y solicitudes del
   * anterior — y un delta nunca lo corregiría, porque esas filas no cambiaron del lado
   * del servidor, simplemente dejaron de corresponderle.
   *
   * SIEMPRE PIDE CONFIRMACIÓN, aun sin nada pendiente.
   *
   * Antes salía directo cuando no había trabajo sin subir, con el razonamiento de que
   * así no se perdía nada. Ese razonamiento miraba sólo la mitad: no se pierde ningún
   * registro, pero sí la base entera, y volver a bajarla son cientos de filas. Para un
   * promotor en el campo con datos móviles eso no es gratis, y un toque accidental en
   * el drawer no puede costarlo — sobre todo estando pegado a otras opciones inocuas.
   */
  const salir = async () => {
    const pendientes = await resumenPendientes();
    const ejecutar = async (descartar: boolean) => {
      try {
        await cerrarSesion({ descartar });
        logout();
      } catch (e) {
        setUltimoError((e as Error)?.message ?? "No se pudo cerrar la sesión");
      }
    };

    if (pendientes.total === 0) {
      Alert.alert(
        "Cerrar sesión",
        "Se borran los datos de este teléfono: pertenecen a tu usuario y a tu zona. " +
          "No hay nada sin enviar, así que no se pierde trabajo, pero al volver a " +
          "entrar hay que bajarlos completos del servidor.",
        [
          { text: "Cancelar", style: "cancel" },
          { text: "Cerrar sesión", style: "destructive", onPress: () => void ejecutar(false) },
        ]
      );
      return;
    }

    Alert.alert(
      "Hay trabajo sin enviar",
      `Todavía no subieron: ${describirPendientes(pendientes)}.

` +
        "Al cerrar sesión se borran los datos de este teléfono y ESO SE PIERDE. " +
        "Conviene sincronizar primero.",
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

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setUltimoError(null);
    try {
      // Desde que el sync es resiliente, las colecciones que no se pudieron traer
      // VUELVEN acá en vez de tirar: las demás ya se aplicaron. Que falle una parte no
      // es lo mismo que no haber sincronizado, y el mensaje lo dice distinto —
      // decírselo igual haría que el promotor desconfíe de un sync que sí sirvió.
      const fallos = await syncNow();
      if (fallos.length > 0) {
        const todas = fallos.length >= COLLECTIONS.length;
        setUltimoError(
          todas
            ? describirFallos(fallos)
            : `Sincronizado, pero sin traer: ${describirFallos(fallos)}`
        );
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? "Error desconocido";
      console.warn("sync failed", msg);
      setUltimoError(msg);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={styles.drawerContent}>
      <View style={styles.drawerHeader}>
        {/* El logo del cliente donde antes decía "Promotor". El promotor abre el
            drawer decenas de veces al día; es el lugar donde la marca se ve sin
            robarle espacio a ninguna lista. Si el PNG todavía no está puesto, cae
            al nombre en texto y no queda un hueco. */}
        {cliente.logo ? (
          <Image
            source={cliente.logo}
            style={styles.drawerLogo}
            resizeMode="contain"
            accessibilityLabel={cliente.nombreLargo}
          />
        ) : (
          <Text style={styles.drawerTitle}>{cliente.nombre}</Text>
        )}
        {user && <Text style={styles.drawerUser}>{user.usuario}</Text>}
        {/* Contexto siempre visible: sin esto el promotor no sabe por qué no ve
            un productor o una solicitud que espera. */}
        <Text style={styles.drawerUser}>
          Cosecha {cosecha ?? "—"} · {descripcionZonas(todasLasZonas, zonas, zonasNombres)}
        </Text>
      </View>

      {/* El error va ARRIBA de las acciones y no debajo de una de ellas: lo escriben
          las cuatro (sincronizar, cambiar cosecha, rebajar, salir) y ubicado después
          de "Cambiar cosecha" parecía de esa, que es de las que menos falla. */}
      {ultimoError ? (
        <View style={styles.drawerErrorCaja}>
          <Text style={styles.drawerError}>⚠ {ultimoError}</Text>
        </View>
      ) : null}

      <DrawerItem
        label={syncing ? "Sincronizando..." : etiquetaSync(pendientes)}
        onPress={handleSync}
        labelStyle={[
          styles.drawerLabel,
          pendientes.total > 0 ? { color: "#fbbf24", fontWeight: "700" } : null,
        ]}
      />
      <DrawerItem
        label={cambiando ? "Cambiando cosecha..." : "Cambiar cosecha"}
        onPress={abrirCambioCosecha}
        labelStyle={styles.drawerLabel}
      />

      {/* Servidor: cada beneficio corre el suyo en su red. Sin esta entrada, un
          cambio de IP obligaría a recompilar el APK e instalarlo teléfono por
          teléfono. */}
      <DrawerItem
        label="Servidor"
        onPress={() => props.navigation.navigate("Servidor")}
        labelStyle={styles.drawerLabel}
      />

      {/* Diagnóstico: qué intentó este teléfono. Es lo que se lee por teléfono
          cuando el promotor dice "no envió nada". */}
      <DrawerItem
        label="Bitácora del teléfono"
        onPress={() => props.navigation.navigate("Bitacora")}
        labelStyle={styles.drawerLabel}
      />

      {/* Las dos que borran la base local, agrupadas y separadas del resto.
          No es decoración: las opciones de arriba son inocuas y éstas cuestan una
          rebajada completa. Tenerlas mezcladas hace que un toque errado en un
          teléfono, con una mano, salga caro. */}
      <View style={styles.drawerSeparador}>
        <Text style={styles.drawerSeccion}>Borra los datos del teléfono</Text>
      </View>

      <DrawerItem
        label={rebajando ? "Rebajando datos..." : "Rebajar todos los datos"}
        onPress={rebajarDatos}
        labelStyle={styles.drawerLabel}
      />

      <DrawerItem
        label="Cerrar sesión"
        onPress={salir}
        labelStyle={styles.drawerLabel}
      />

      <PickerModal
        visible={pickerCosecha}
        titulo="Cambiar cosecha"
        opciones={cosechas.map((c) => ({ valor: c, titulo: c }))}
        onSeleccionar={aplicarCosecha}
        onCerrar={() => setPickerCosecha(false)}
      />
    </DrawerContentScrollView>
  );
}

const Drawer = createDrawerNavigator();
function AuthenticatedNav() {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <CustomDrawer {...props} />}
      screenOptions={{
        // El header visible es el del Stack interno de cada tab; el drawer no
        // rendera el suyo para no apilar dos. El hamburguesa vive en cada Stack.
        headerShown: false,
        drawerStyle: { backgroundColor: cliente.chrome },
      }}
    >
      <Drawer.Screen name="Main" component={MainTabs} />
      {/* Bitácora: se llega desde el drawer, no desde un tab. Es una pantalla de
          diagnóstico —se abre cuando algo no cuadra—, no parte del trabajo diario. */}
      <Drawer.Screen
        name="Bitacora"
        component={BitacoraScreen}
        options={{
          headerShown: true,
          title: "Bitácora del teléfono",
          headerStyle: { backgroundColor: cliente.chrome },
          headerTintColor: "#f1f5f9",
        }}
      />
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
  );
}

// ─── Root ────────────────────────────────────────────────────────────

/**
 * Puerta del cambio de clave vencida.
 *
 * El BE marca `passwordExpired` en el login Y en el refresh, pero emite la sesión
 * igual y delega en el cliente forzar el cambio. Sin esta puerta, en el teléfono
 * la política no se aplicaba: el promotor entraba, trabajaba, y nadie se enteraba.
 *
 * LAS TRES CONDICIONES, Y POR QUÉ CADA UNA
 * ----------------------------------------
 *   passwordExpired   lo obvio: el servidor dice que venció.
 *
 *   huboSyncOk        este teléfono ya habló con SU servidor en esta corrida. Sin
 *                     esto, un promotor sin señal quedaría bloqueado sin poder
 *                     cambiar la clave —el endpoint es remoto—, encerrado afuera
 *                     de sus propios datos en el campo.
 *
 *   porEnviar === 0   no queda trabajo que dependa de él. Perder una jornada de
 *                     campo es peor que una clave vencida un día más.
 *
 * Se mira `porEnviar` y NO `total`: las retenidas esperan un evento de negocio y no
 * se van sincronizando (ver usePendientes). Con `total` bastaría una fila retenida
 * para que a ese promotor no se le pidiera la clave NUNCA.
 */
function PuertaClaveVencida({ children }: { children: React.ReactNode }) {
  const passwordExpired = useAuthStore((s) => s.passwordExpired);
  const huboSyncOk = useSyncEstado((s) => s.huboSyncOk);
  const { porEnviar, cargando } = usePendientes();

  // `cargando` no es un detalle: los contadores arrancan en 0 mientras la base
  // responde, y acá 0 significa "exigí la clave". Sin esperarlos, la pantalla
  // aparecía un instante encima de la app y se iba sola cuando llegaba el conteo.
  if (passwordExpired && huboSyncOk && !cargando && porEnviar === 0) {
    return <CambiarClaveScreen />;
  }

  // Cuando el servidor DICE que la clave vencio pero la puerta no se abre, hay que
  // poder saber cual de las tres condiciones falta. Sin esto el sintoma es "no pasa
  // nada", que no distingue "todavia no toca" de "esta roto" — y son la misma
  // pantalla en blanco.
  if (passwordExpired) {
    console.info(
      `[clave] vencida, puerta cerrada: huboSyncOk=${huboSyncOk} cargando=${cargando} porEnviar=${porEnviar}`
    );
  }
  return <>{children}</>;
}

export default function App() {
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootDone, setBootDone] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitializing = useAuthStore((s) => s.isInitializing);
  const sesionCompanyId = useSesion((s) => s.companyId);
  const sesionCosecha = useSesion((s) => s.cosecha);
  const hidratandoSesion = useSesion((s) => s.hidratando);
  // Cambia después de un reset de la base local (rebajar datos / cambiar cosecha) y
  // fuerza a que todo el árbol se vuelva a montar. Ver `remontar` en lib/sesion.ts.
  const generacion = useSesion((s) => s.generacion);
  const hidratarSesion = useSesion((s) => s.hidratar);

  useEffect(() => {
    bootstrapApi()
      .then(() => hidratarSesion())
      .then(async () => {
        // ¿Le cambiaron las zonas autorizadas desde la última vez?
        //
        // Hace falta revisarlo explícitamente porque el pull es un DELTA: si le suman
        // una zona, las filas de esa zona no cambiaron del lado del servidor, así que
        // no entran en ningún delta y el teléfono no las vería NUNCA. Un cambio de
        // alcance no se arregla sincronizando — hay que rebajar todo.
        //
        // Best-effort: sin señal no hace nada y se revisa la próxima vez.
        try {
          const { aviso } = await verificarAlcance();
          if (aviso) setBootError(aviso);
        } catch (err) {
          console.info("no se pudo verificar el alcance", (err as Error)?.message);
        }
      })
      .then(() => setBootDone(true))
      .catch((e) => {
        setBootError(e?.message ?? "Error inicializando el app");
        setBootDone(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <NavigationContainer theme={navTheme}>
          {(() => {
            if (!bootDone || isInitializing || hidratandoSesion) {
              return (
                <View style={styles.center}>
                  <ActivityIndicator size="large" color="#3b82f6" />
                  <Text style={styles.loadingText}>Iniciando...</Text>
                </View>
              );
            }
            if (bootError) {
              return (
                <View style={styles.center}>
                  <Text style={styles.errorText}>⚠ {bootError}</Text>
                </View>
              );
            }
            if (!isAuthenticated) return <LoginScreen />;
            // Autenticado pero sin contexto de trabajo: el sync está scopeado por
            // empresa y cosecha, así que entrar sin elegirlas no traería nada.
            if (sesionCompanyId == null || !sesionCosecha) return <ContextoScreen />;
            return (
              <PuertaClaveVencida>
                <AuthenticatedNav key={generacion} />
              </PuertaClaveVencida>
            );
          })()}
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: cliente.chrome,
  },
  loadingText: { color: "#94a3b8", marginTop: 12 },
  errorText: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
  drawerContent: { paddingTop: 24 },
  drawerHeader: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
    marginBottom: 12,
  },
  drawerTitle: { color: "#f1f5f9", fontSize: 20, fontWeight: "700" },
  /**
   * Fondo blanco a propósito: ninguno de los logos que mandó el cliente viene con
   * transparencia, así que sobre el drawer oscuro aparecería igual un rectángulo
   * claro. Con padding y esquinas redondeadas ese rectángulo se lee como una placa
   * de marca y no como un error de recorte.
   */
  drawerLogo: {
    width: 176,
    height: 68,
    backgroundColor: "#ffffff",
    borderRadius: 8,
    alignSelf: "flex-start",
    marginBottom: 10,
  },
  drawerUser: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
  drawerLabel: { color: "#e2e8f0" },
  drawerSeparador: {
    borderTopWidth: 1,
    borderTopColor: "#334155",
    marginTop: 12,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  drawerSeccion: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  drawerErrorCaja: {
    backgroundColor: "#7f1d1d",
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 6,
    paddingVertical: 10,
  },
  drawerError: {
    color: "#fecaca",
    fontSize: 12,
    paddingHorizontal: 12,
    lineHeight: 17,
  },
});
