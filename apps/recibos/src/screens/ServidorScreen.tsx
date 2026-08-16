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
import { cambiarServidor } from "../lib/alcance";
import { describirPendientes, resumenPendientes } from "../lib/sync";
import {
  guardarModoImpresion,
  modoImpresion,
  type ModoImpresion,
} from "../lib/modoImpresion";
import { PedirClave } from "./PedirClave";
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
  /**
   * El modo de impresión NO exige reiniciar, al revés que la dirección del servidor: se
   * consulta en cada impresión y no al construir un cliente. Esa diferencia es deliberada —
   * el otro caso ya nos costó una tarde de "error de red" con la pantalla diciendo que todo
   * estaba bien.
   */
  const [modo, setModo] = useState<ModoImpresion>(modoImpresion());
  const elegirModo = async (m: ModoImpresion) => {
    await guardarModoImpresion(m);
    setModo(m);
  };
  const [texto, setTexto] = useState(urlServidor());
  const [probando, setProbando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; msg: string } | null>(null);
  const usuario = useAuthStore((e) => e.user?.usuario ?? "");
  /**
   * La acción destructiva esperando la clave.
   *
   * ⚠️ Cambiar de servidor BORRA la base, igual que cambiar de recibidor, así que pide la
   * clave por la misma razón: es la única fricción proporcional a algo irreversible. Ya
   * había una confirmación —y se queda— pero un "¿Seguro?" se acepta por reflejo, y acá
   * lo que se pierde puede ser el día de trabajo de alguien.
   */
  const [pedirClave, setPedirClave] = useState<{
    titulo: string;
    advertencia: string;
    textoAccion: string;
    ejecutar: () => void;
  } | null>(null);

  const vigente = urlServidor();
  const compilada = urlCompilada();

  /**
   * ¿Lo que hay escrito difiere de lo que se está usando?
   *
   * Se compara NORMALIZADO para no avisar por diferencias que no lo son: `192.168.1.50:5249`
   * y `http://192.168.1.50:5249` son la misma dirección, y marcarlas como distintas
   * entrenaría a ignorar el aviso. Si el texto no es una dirección válida, se avisa igual
   * —con más razón: eso seguro no es lo que está en uso.
   */
  const sinGuardar = (() => {
    if (!texto.trim()) return false;
    try {
      return normalizarUrl(texto) !== vigente;
    } catch {
      return true;
    }
  })();

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
      // Cambiar de servidor BORRA la base: los datos son de otra empresa y de otra base.
      // No se vuelve a preguntar porque el usuario ya vio arriba qué se iba a perder.
      await cambiarServidor();
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
          // Confirmación PRIMERO y clave después: la confirmación dice qué se pierde, la
          // clave obliga a detenerse. Ver la nota en Navegacion.
          onPress: () =>
            setPedirClave({
              titulo: "Cambiar de servidor",
              advertencia:
                `Se apunta a ${url} y se borran los datos de este teléfono.` + detalle,
              textoAccion: "Cambiar",
              ejecutar: () => void aplicar(url),
            }),
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
          onPress: () =>
            setPedirClave({
              titulo: "Volver a la dirección original",
              advertencia:
                `Se vuelve a ${compilada} y se borran los datos de este teléfono.`,
              textoAccion: "Restaurar",
              ejecutar: () => {
                void (async () => {
                  const url = await restaurarUrlServidor();
                  setTexto(url);
                  await cambiarServidor();
                })();
              },
            }),
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

      {/*
        ⚠️ LO ESCRITO NO ES LO QUE ESTÁ EN USO, Y HAY QUE DECIRLO.
        
        Al cancelar la clave —o simplemente al escribir y no guardar— la caja se queda con
        lo tecleado. La dirección real sigue abajo, en "En uso", pero la caja es lo que uno
        mira: un número malo ahí se lee como si estuviera configurado, y quien revisa por
        qué no conecta concluye que la app está rota.
        
        No se revierte solo a propósito: si escribiste mal un dígito, borrarte el texto te
        obliga a teclear la dirección entera de nuevo. Se avisa y se ofrece descartarlo.
      */}
      {sinGuardar ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 8,
            backgroundColor: "#fef3c7",
          }}
        >
          <Text style={{ color: "#92400e", fontSize: 13, flex: 1 }}>
            Escrito pero SIN GUARDAR. Se sigue usando {vigente}.
          </Text>
          <TouchableOpacity onPress={() => setTexto(vigente)} hitSlop={8}>
            <Text style={{ color: "#92400e", fontSize: 13, fontWeight: "700" }}>
              Descartar
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

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

      {/* ── Cómo imprime este teléfono ───────────────────────────────────────── */}
      <Text style={[estilos.seccion, { marginTop: 28 }]}>Impresión</Text>
      <Text style={{ color: colores.textoTenue, fontSize: 13, marginBottom: 10 }}>
        El recibo y la remedida. La bitácora siempre va directa: su largo depende de cuántos
        recibos lleve y el diálogo de Android no lo admite.
      </Text>

      {(
        [
          {
            valor: "driver" as const,
            titulo: "Con ESCprint",
            detalle:
              "El papel sale igual que desde la oficina, con su tipografía. Hay que instalar " +
              "y configurar ESCprint Service en este teléfono, y elegir la impresora en cada " +
              "impresión.",
          },
          {
            valor: "directo" as const,
            titulo: "Directo a la impresora",
            detalle:
              "No hace falta instalar nada y es un solo toque por documento. El logo sale " +
              "igual; el texto usa la letra interna de la impresora. Requiere una sola " +
              "impresora emparejada.",
          },
        ]
      ).map((op) => (
        <TouchableOpacity
          key={op.valor}
          onPress={() => void elegirModo(op.valor)}
          style={{
            borderWidth: 1,
            borderColor: modo === op.valor ? cliente.chrome : colores.borde,
            backgroundColor: modo === op.valor ? colores.superficie : "transparent",
            borderRadius: 10,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: colores.texto, fontWeight: "700", fontSize: 15 }}>
            {modo === op.valor ? "● " : "○ "}
            {op.titulo}
          </Text>
          <Text style={{ color: colores.textoTenue, fontSize: 13, marginTop: 4 }}>
            {op.detalle}
          </Text>
        </TouchableOpacity>
      ))}

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

      <PedirClave
        visible={pedirClave != null}
        usuario={usuario}
        titulo={pedirClave?.titulo ?? ""}
        advertencia={pedirClave?.advertencia ?? ""}
        textoAccion={pedirClave?.textoAccion ?? ""}
        onCancelar={() => setPedirClave(null)}
        onConfirmar={() => {
          const accion = pedirClave?.ejecutar;
          setPedirClave(null);
          accion?.();
        }}
      />
    </ScrollView>
  );
}
