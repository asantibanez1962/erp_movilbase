import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from "react-native";
import { cliente } from "../branding";
import { hayClave, verificarClave } from "../lib/clave";
import { colores, estilos } from "./estilos";

/**
 * Pide la clave del usuario antes de una acción que borra datos.
 *
 * No usa `Alert.prompt` porque **sólo existe en iOS**: en Android no hace nada y el
 * diálogo saldría sin campo donde escribir. De ahí el modal propio.
 *
 * Si la sesión se abrió antes de que esto existiera no hay hash sellado, y entonces esta
 * pantalla se salta sola: dejar a alguien sin poder cerrar sesión hasta que adivine una
 * clave que nunca se guardó sería peor que la falta de guarda.
 */
export function PedirClave({
  visible,
  usuario,
  titulo,
  advertencia,
  textoAccion,
  onConfirmar,
  onCancelar,
}: Readonly<{
  visible: boolean;
  usuario: string;
  titulo: string;
  /** Qué se pierde exactamente. Va en rojo, arriba del campo. */
  advertencia: string;
  textoAccion: string;
  onConfirmar: () => void;
  onCancelar: () => void;
}>) {
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verificando, setVerificando] = useState(false);

  // Al abrirse se limpia: la clave de un intento anterior no debe quedar escrita.
  useEffect(() => {
    if (visible) {
      setClave("");
      setError(null);
      // Sesión vieja sin clave sellada: se deja pasar en vez de trabar al usuario.
      void hayClave().then((hay) => {
        if (!hay) onConfirmar();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const confirmar = async () => {
    if (verificando) return;
    setVerificando(true);
    setError(null);
    try {
      if (await verificarClave(usuario, clave)) {
        onConfirmar();
      } else {
        setError("La clave no coincide.");
        setClave("");
      }
    } finally {
      setVerificando(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancelar}>
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View style={{ backgroundColor: colores.superficie, borderRadius: 14, padding: 20, gap: 14 }}>
          <Text style={{ color: colores.texto, fontSize: 18, fontWeight: "700" }}>{titulo}</Text>

          <Text style={{ color: colores.error, fontSize: 14, lineHeight: 20 }}>
            {advertencia}
          </Text>

          <Text style={{ color: colores.textoTenue, fontSize: 13 }}>
            Escribí tu clave para confirmar.
          </Text>

          <TextInput
            value={clave}
            onChangeText={setClave}
            placeholder="Clave"
            placeholderTextColor={colores.textoTenue}
            secureTextEntry
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={() => void confirmar()}
            style={{
              backgroundColor: colores.fondo,
              borderWidth: 1,
              borderColor: error ? colores.error : colores.borde,
              borderRadius: 10,
              paddingHorizontal: 14,
              minHeight: 50,
              color: colores.texto,
              fontSize: 16,
            }}
          />

          {error ? <Text style={{ color: colores.error, fontSize: 13 }}>{error}</Text> : null}

          <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              onPress={onCancelar}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colores.borde,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colores.texto, fontSize: 15, fontWeight: "600" }}>
                Cancelar
              </Text>
            </TouchableOpacity>

            {/* El destructivo a la DERECHA y en rojo: el pulgar cae primero en Cancelar. */}
            <TouchableOpacity
              onPress={() => void confirmar()}
              disabled={clave.length === 0 || verificando}
              style={{
                flex: 1,
                minHeight: 48,
                borderRadius: 10,
                backgroundColor: clave.length === 0 ? colores.borde : colores.error,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {verificando ? (
                <ActivityIndicator color={cliente.acento} />
              ) : (
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
                  {textoAccion}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
