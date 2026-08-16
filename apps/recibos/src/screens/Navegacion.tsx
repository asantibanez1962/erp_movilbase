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
import { PedirClave } from "./PedirClave";
import { describirFallos } from "@erp/shared-sync";
import type { Bitacora, Recibo, Remedida } from "../db/models";
import { cliente } from "../branding";
import { cerrarSesion, cambiarRecibidor } from "../lib/alcance";
import { describirPendientes, resumenPendientes, syncNow } from "../lib/sync";
import { useSesion } from "../lib/sesion";
import { BitacorasScreen } from "./BitacorasScreen";
import { AbrirBitacoraScreen } from "./AbrirBitacoraScreen";
import { BitacoraScreen } from "./BitacoraScreen";
import { ReciboScreen } from "./ReciboScreen";
import { ReciboDetalleScreen } from "./ReciboDetalleScreen";
import { RecibosScreen } from "./RecibosScreen";
import { RemedidasScreen } from "./RemedidasScreen";
import { RemedidaScreen } from "./RemedidaScreen";
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
  Bitacoras: undefined;
  AbrirBitacora: undefined;
  // La bitácora viaja como INSTANCIA de WatermelonDB y no como un id: es observable, así
  // que la pantalla se entera sola cuando se le agrega un recibo o se cierra. Con un id
  // habría que volver a buscarla y suscribirse a mano en cada entrada.
  Bitacora: { bitacora: Bitacora };
  Recibos: undefined;
  Recibo: { bitacora?: Bitacora; recibo?: Recibo };
  ReciboDetalle: { recibo: Recibo };
  Remedidas: undefined;
  Remedida: { remedida?: Remedida };
  EditarBitacora: { bitacora: Bitacora };
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
        name="Bitacoras"
        options={({ navigation }) => ({
          title: "Bitácoras",
          headerLeft: () => <BotonMenu navigation={navigation} />,
        })}
      >
        {({ navigation }) => (
          <BitacorasScreen
            onAbrir={() => navigation.navigate("AbrirBitacora")}
            onEntrar={(b) => navigation.navigate("Bitacora", { bitacora: b })}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="AbrirBitacora" options={{ title: "Abrir bitácora" }}>
        {({ navigation }) => (
          <AbrirBitacoraScreen
            // replace: la pantalla de apertura no tiene sentido en el historial. Si
            // quedara, el "atrás" desde la bitácora recién creada volvería a un
            // formulario que ya se usó.
            onListo={(b) => navigation.replace("Bitacora", { bitacora: b })}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Bitacora" options={{ title: "Bitácora" }}>
        {({ navigation, route }) => (
          <BitacoraScreen
            bitacora={route.params.bitacora}
            // ⚠️ "Bitacoras" SIN TILDE: es el NOMBRE de la ruta, no el título que se ve
            // arriba. Con la tilde react-navigation no encuentra ninguna pantalla y tira
            // "The action 'NAVIGATE' ... was not handled by any navigator" — justo al
            // volver de imprimir, que es cuando más asusta.
            onVolver={() => navigation.navigate("Bitacoras")}
            onNuevoRecibo={() =>
              navigation.navigate("Recibo", { bitacora: route.params.bitacora })
            }
            // Misma regla que en la lista: sin imprimir se EDITA, impreso sólo se mira.
            onVerRecibo={(r) =>
              (r.impreso ?? 0) === 0
                ? navigation.navigate("Recibo", { recibo: r })
                : navigation.navigate("ReciboDetalle", { recibo: r })
            }
            onEditar={() =>
              navigation.navigate("EditarBitacora", { bitacora: route.params.bitacora })
            }
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="ReciboDetalle" options={{ title: "Recibo" }}>
        {({ navigation, route }) => (
          <ReciboDetalleScreen
            recibo={route.params.recibo}
            onVolver={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="EditarBitacora" options={{ title: "Datos de la bitácora" }}>
        {({ navigation, route }) => (
          <AbrirBitacoraScreen
            bitacora={route.params.bitacora}
            onListo={() => navigation.goBack()}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Recibo" options={{ title: "Recibo" }}>
        {({ navigation, route }) => (
          <ReciboScreen
            bitacora={route.params?.bitacora}
            recibo={route.params?.recibo}
            onListo={() => navigation.goBack()}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

/**
 * Recibos tiene su propio stack, hermano del de bitácoras.
 *
 * Se separaron porque son dos formas distintas de trabajar: la bitácora es la contabilidad
 * del día —se abre, se le cuelgan recibos, se cierra e imprime— y el recibo es lo que se
 * busca de verdad, por número o por productor, sin acordarse de en qué bitácora quedó.
 * Tenerlo colgando de la bitácora obligaba a recorrer el día entero para llegar a uno.
 */
function RecibosStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: cliente.chrome },
        headerTintColor: "#f1f5f9",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Stack.Screen
        name="Recibos"
        options={({ navigation }) => ({
          title: "Recibos",
          headerLeft: () => <BotonMenu navigation={navigation} />,
        })}
      >
        {({ navigation }) => (
          <RecibosScreen
            onNuevo={() => navigation.navigate("Recibo", {})}
            // Sin imprimir se EDITA; impreso, sólo se mira y se puede anular. Es la misma
            // condición que lo retiene en el teléfono: mientras no salga en papel es
            // trabajo en curso.
            onAbrir={(r) =>
              (r.impreso ?? 0) === 0
                ? navigation.navigate("Recibo", { recibo: r })
                : navigation.navigate("ReciboDetalle", { recibo: r })
            }
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Recibo" options={{ title: "Recibo" }}>
        {({ navigation, route }) => (
          <ReciboScreen
            bitacora={route.params?.bitacora}
            recibo={route.params?.recibo}
            onListo={() => navigation.goBack()}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="ReciboDetalle" options={{ title: "Recibo" }}>
        {({ navigation, route }) => (
          <ReciboDetalleScreen
            recibo={route.params.recibo}
            onVolver={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

const Drawer = createDrawerNavigator();

/**
 * Remedidas: el camión que llega de los recibidores.
 *
 * Menú propio y no colgando de la bitácora, porque no pertenece a una: se captura en el
 * sitio de recepción de camiones, que es otro lugar y otro momento del día.
 */
function RemedidasStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: cliente.chrome },
        headerTintColor: "#f1f5f9",
        headerTitleStyle: { fontWeight: "700" },
      }}
    >
      <Stack.Screen
        name="Remedidas"
        options={({ navigation }) => ({
          title: "Remedidas",
          headerLeft: () => <BotonMenu navigation={navigation} />,
        })}
      >
        {({ navigation }) => (
          <RemedidasScreen
            onNueva={() => navigation.navigate("Remedida", {})}
            // Misma regla que el recibo: sin imprimir se EDITA, impresa sólo se mira.
            onAbrir={(r) => navigation.navigate("Remedida", { remedida: r })}
          />
        )}
      </Stack.Screen>

      <Stack.Screen name="Remedida" options={{ title: "Remedida" }}>
        {({ navigation, route }) => (
          <RemedidaScreen
            remedida={route.params?.remedida}
            onListo={() => navigation.goBack()}
            onCancelar={() => navigation.goBack()}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
}


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
        <Drawer.Screen
          name="MenuBitacoras"
          component={JornadasStack}
          options={{ title: "Bitácoras" }}
        />
        <Drawer.Screen
          name="MenuRecibos"
          component={RecibosStack}
          options={{ title: "Recibos" }}
        />
        <Drawer.Screen
          name="MenuRemedidas"
          component={RemedidasStack}
          options={{ title: "Remedidas" }}
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
    </NavigationContainer>
  );
}

/**
 * ⚠️ Las rutas del DRAWER llevan otro nombre que las del stack de adentro
 * (`MenuBitacoras` → stack `Bitacoras`). Con el mismo nombre, react-navigation avisaba
 * —"screens with the same name nested inside one another"— y no es cosmético: al navegar
 * por nombre puede resolver a la pantalla equivocada, y eso aparece como un salto raro
 * que nadie asocia con el nombre de una ruta.
 */
function ContenidoDrawer(props: DrawerContentComponentProps) {
  const user = useAuthStore((s) => s.user);
  const recibidor = useSesion((s) => s.recibidorNombre ?? s.recibidor);
  const cosecha = useSesion((s) => s.cosecha);
  const [sincronizando, setSincronizando] = useState(false);
  const [ultimoError, setUltimoError] = useState<string | null>(null);
  /** La acción destructiva esperando la clave. Null ⇒ el modal está cerrado. */
  const [pedirClave, setPedirClave] = useState<{
    titulo: string;
    advertencia: string;
    textoAccion: string;
    ejecutar: () => void;
  } | null>(null);

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
   * Las dos salidas borran la base local, y ahora **piden la clave del usuario**.
   *
   * El orden es deliberado: primero se dice QUÉ se pierde —la lista, no un número— y
   * recién ahí se pide la clave. Un número no alcanza para decidir si vale la pena
   * descartar el trabajo de una mañana, y un "¿Seguro?" se acepta por reflejo.
   *
   * ⚠️ LO QUE HAY EN JUEGO. Si la bitácora del día no cerró, sus recibos **sólo existen
   * en este teléfono**: no se imprimieron todos, no subieron, y no hay copia en ninguna
   * parte. Dos toques en un menú, con el teléfono en una mano y bajo el sol, y se pierde
   * el día entero. Ver `lib/clave.ts`.
   */
  const salir = async (
    accion: (o: { descartar: boolean }) => Promise<void>,
    titulo: string,
    /** Si esta acción BORRA los datos del teléfono. Cambia el aviso entero. */
    borra: boolean
  ) => {
    setUltimoError(null);
    const ejecutar = (descartar: boolean) =>
      accion({ descartar }).catch((e: Error) => setUltimoError(e.message));

    const pendientes = await resumenPendientes();
    setPedirClave({
      titulo,
      textoAccion: pendientes.total === 0 ? titulo : "Salir y descartar",
      advertencia:
        pendientes.total === 0
          ? "Se borran los datos de este teléfono: pertenecen a tu usuario y a tu " +
            "recibidor. No hay nada sin enviar, así que no se pierde trabajo."
          : `Todavía no subieron: ${describirPendientes(pendientes)}.\n\n` +
            "Se borran los datos de este teléfono y ESO SE PIERDE. Si podés, cerrá la " +
            "bitácora e imprimila primero.",
      ejecutar: () => void ejecutar(pendientes.total > 0),
    });
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
        label="Bitácoras"
        onPress={() => props.navigation.navigate("MenuBitacoras")}
        labelStyle={estilosDrawer.label}
      />
      <DrawerItem
        label="Recibos"
        onPress={() => props.navigation.navigate("MenuRecibos")}
        labelStyle={estilosDrawer.label}
      />
      <DrawerItem
        label="Remedidas"
        onPress={() => props.navigation.navigate("MenuRemedidas")}
        labelStyle={estilosDrawer.label}
      />

      <View style={estilosDrawer.separador}>
        <Text style={estilosDrawer.seccion}>Datos</Text>
      </View>

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
        <Text style={estilosDrawer.seccion}>Salir</Text>
      </View>

      <DrawerItem
        label="Cambiar recibidor y borrar datos"
        onPress={() => void salir(cambiarRecibidor, "Cambiar recibidor", true)}
        labelStyle={estilosDrawer.label}
      />
      <DrawerItem
        label="Cerrar sesión"
        onPress={() => void salir(cerrarSesion, "Cerrar sesión", false)}
        labelStyle={estilosDrawer.label}
      />

      <PedirClave
        visible={pedirClave != null}
        usuario={user?.usuario ?? ""}
        titulo={pedirClave?.titulo ?? ""}
        advertencia={pedirClave?.advertencia ?? ""}
        textoAccion={pedirClave?.textoAccion ?? ""}
        onCancelar={() => setPedirClave(null)}
        /**
         * ⚠️ LA CLAVE NO REEMPLAZA AL "¿SEGURO?", VA ANTES.
         *
         * Escribir la clave y darle a Aceptar se despacha en un segundo, y el borrado
         * arranca sin que haya un instante para arrepentirse. Son dos frenos distintos y
         * los dos hacen falta: la clave obliga a DETENERSE —hay que pensar y teclear— y
         * la confirmación obliga a DECIDIR, con lo que se pierde escrito enfrente.
         *
         * En este orden y no al revés: preguntar primero y pedir la clave después
         * convertiría la clave en un trámite después de que ya dijiste que sí.
         */
        onConfirmar={() => {
          const pendiente = pedirClave;
          setPedirClave(null);
          if (!pendiente) return;
          Alert.alert(
            pendiente.titulo,
            `${pendiente.advertencia}\n\n¿Borro los datos de este teléfono?`,
            [
              { text: "No", style: "cancel" },
              {
                text: pendiente.textoAccion,
                style: "destructive",
                onPress: pendiente.ejecutar,
              },
            ]
          );
        }}
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
