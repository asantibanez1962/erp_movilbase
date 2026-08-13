import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "../branding";
import {
  guardarUrlServidor,
  hayOverride,
  normalizarUrl,
  restaurarUrlServidor,
  urlCompilada,
  urlServidor,
} from "../lib/servidor";
import { cerrarSesion } from "../lib/alcance";
import { describirPendientes, resumenPendientes } from "../lib/sync";
import { colores, estilos } from "./estilos";

/**
 * Dirección del backend de este beneficio.
 *
 * Está en el drawer y no escondida en un build porque cada cliente corre su servidor
 * en su propia red: si le cambian la IP, sin esta pantalla habría que recompilar el
 * APK y volver a instalarlo teléfono por teléfono.
 *
 * CAMBIAR DE SERVIDOR BORRA LOS DATOS LOCALES. No es una precaución exagerada: los
 * ids, las zonas y las cosechas que hay en el teléfono pertenecen a UNA base. Si se
 * apunta a otra, las filas locales referencian productores que allá no existen o —
 * peor— que existen con otro dueño. Y un delta jamás lo corregiría, porque del lado
 * del servidor nuevo esas filas nunca cambiaron: simplemente son de otra base. Es el
 * mismo razonamiento por el que cambiar de cosecha, ampliar zonas o cerrar sesión
 * rebajan todo.
 */
export function ServidorScreen({
  onVolver,
}: Readonly<{ onVolver?: () => void }> = {}) {
  const [texto, setTexto] = useState(urlServidor());
  const [probando, setProbando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  const logout = useAuthStore((s) => s.logout);

  const vigente = urlServidor();
  const compilada = urlCompilada();

  /**
   * Probar la conexión.
   *
   * Alcanza con que el host RESPONDA algo — un 401 o un 404 prueban que hay un
   * servidor ahí, que es justo lo que se está diagnosticando. Pedir un endpoint
   * concreto haría que la prueba fallara por permisos o por una ruta que cambió,
   * y mandaría a buscar el problema donde no está.
   */
  const probar = async () => {
    setProbando(true);
    setResultado(null);
    try {
      const url = normalizarUrl(texto);
      const corte = new AbortController();
      const timer = setTimeout(() => corte.abort(), 6000);
      try {
        const r = await fetch(url, { method: "GET", signal: corte.signal });
        setResultado({
          ok: true,
          msg: `Responde (HTTP ${r.status}). Hay un servidor en esa dirección.`,
        });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const err = e as Error;
      setResultado({
        ok: false,
        msg:
          err.name === "AbortError"
            ? "No respondió en 6 segundos. Revisá que el teléfono esté en la red del beneficio."
            : (err.message ?? "No se pudo conectar."),
      });
    } finally {
      setProbando(false);
    }
  };

  /** Aplica la dirección nueva: borra la base local y saca al usuario. */
  const aplicar = async (url: string) => {
    setGuardando(true);
    try {
      await guardarUrlServidor(url);
      // Se descarta lo pendiente sólo si ya se confirmó arriba; acá no se vuelve a
      // preguntar porque el usuario ya vio QUÉ se iba a perder.
      await cerrarSesion({ descartar: true });
      logout();
    } catch (e) {
      setResultado({ ok: false, msg: (e as Error)?.message ?? "No se pudo guardar." });
    } finally {
      setGuardando(false);
    }
  };

  const guardar = async () => {
    setResultado(null);
    let url: string;
    try {
      url = normalizarUrl(texto);
    } catch (e) {
      setResultado({ ok: false, msg: (e as Error).message });
      return;
    }

    if (url === vigente) {
      setResultado({ ok: true, msg: "Ya estaba configurada esa dirección." });
      return;
    }

    const pendientes = await resumenPendientes();
    const detalle =
      pendientes.total > 0
        ? `\n\nOJO: todavía no subieron ${describirPendientes(pendientes)}. ` +
          "Eso se pierde y no se puede recuperar — van dirigidos al servidor viejo."
        : "";

    Alert.alert(
      "Cambiar de servidor",
      `Se va a apuntar a ${url}.\n\n` +
        "Los datos de este teléfono se borran y se vuelven a bajar del servidor nuevo: " +
        "pertenecen a la base anterior y no se pueden mezclar." +
        detalle,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: pendientes.total > 0 ? "Descartar y cambiar" : "Cambiar",
          style: "destructive",
          onPress: () => void aplicar(url),
        },
      ]
    );
  };

  const restaurar = () => {
    Alert.alert(
      "Volver a la dirección original",
      `Se va a usar la que trae la aplicación: ${compilada}. ` +
        "Los datos locales se borran igual que al cambiarla a mano.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Restaurar",
          style: "destructive",
          onPress: () => {
            void (async () => {
              const url = await restaurarUrlServidor();
              setTexto(url);
              await cerrarSesion({ descartar: true });
              logout();
            })();
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={estilos.root} contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={{ alignItems: "center", paddingVertical: 20, gap: 8 }}>
        {cliente.logo ? (
          <Image
            source={cliente.logo}
            style={{ width: 180, height: 80 }}
            resizeMode="contain"
          />
        ) : null}
        <Text style={{ color: colores.texto, fontSize: 16, fontWeight: "700" }}>
          {cliente.nombreLargo}
        </Text>
      </View>

      <Text style={estilos.seccion}>Dirección del servidor</Text>
      <TextInput
        style={estilos.buscador}
        value={texto}
        onChangeText={setTexto}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="192.168.1.50:5249"
        placeholderTextColor={colores.textoTenue}
      />

      <View style={estilos.detalleFila}>
        <Text style={estilos.detalleEtiqueta}>En uso</Text>
        <Text style={estilos.detalleValor}>{vigente}</Text>
      </View>
      <View style={estilos.detalleFila}>
        <Text style={estilos.detalleEtiqueta}>La del instalador</Text>
        <Text style={estilos.detalleValor}>{compilada}</Text>
      </View>

      {resultado ? (
        <Text
          style={{
            color: resultado.ok ? colores.exito : colores.error,
            fontSize: 13,
            paddingHorizontal: 16,
            paddingTop: 12,
            lineHeight: 18,
          }}
        >
          {resultado.ok ? "✓" : "⚠"} {resultado.msg}
        </Text>
      ) : null}

      <View style={{ padding: 16, gap: 12 }}>
        <TouchableOpacity
          onPress={probar}
          disabled={probando || guardando}
          style={{
            backgroundColor: colores.superficie,
            borderWidth: 1,
            borderColor: colores.borde,
            borderRadius: 8,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {probando ? (
            <ActivityIndicator color={colores.primario} />
          ) : (
            <Text style={{ color: colores.texto, fontWeight: "600", fontSize: 15 }}>
              Probar conexión
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={guardar}
          disabled={probando || guardando}
          style={{
            backgroundColor: cliente.chrome,
            borderRadius: 8,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            opacity: guardando ? 0.6 : 1,
          }}
        >
          {guardando ? (
            <ActivityIndicator color="#f1f5f9" />
          ) : (
            <Text style={{ color: "#f1f5f9", fontWeight: "700", fontSize: 15 }}>
              Guardar y reiniciar sesión
            </Text>
          )}
        </TouchableOpacity>

        {hayOverride() ? (
          <TouchableOpacity
            onPress={restaurar}
            disabled={probando || guardando}
            style={{ minHeight: 48, alignItems: "center", justifyContent: "center" }}
          >
            <Text style={{ color: colores.textoTenue, fontSize: 14 }}>
              Volver a la dirección original
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text
        style={{
          color: colores.textoTenue,
          fontSize: 12,
          paddingHorizontal: 16,
          lineHeight: 17,
        }}
      >
        Al guardar se cierra la sesión y se borran los datos de este teléfono: pertenecen
        al servidor anterior. Después de entrar de nuevo, la primera sincronización baja
        todo desde el servidor nuevo.
      </Text>

      {/* Sólo cuando se llega desde el login, que no tiene drawer ni header con
          botón de atrás. Desde el drawer sobra: el header ya lo resuelve. */}
      {onVolver ? (
        <TouchableOpacity
          onPress={onVolver}
          disabled={guardando}
          style={{
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 12,
          }}
        >
          <Text style={{ color: colores.primario, fontSize: 15, fontWeight: "600" }}>
            Volver al ingreso
          </Text>
        </TouchableOpacity>
      ) : null}
    </ScrollView>
  );
}
