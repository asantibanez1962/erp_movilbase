import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "../branding";
import { cargarContexto, type EmpresaContexto } from "../lib/contexto";
import { useSesion } from "../lib/sesion";
import { colores, estilos } from "./estilos";

/**
 * Dónde y cuándo se está trabajando: empresa, recibidor y cosecha.
 *
 * Sin esto el sync no puede arrancar — el pull está recortado por esos tres— así que la
 * app no deja pasar hasta tenerlos. Es la pantalla que se ve una sola vez, la primera
 * mañana, y después nunca más.
 *
 * EL RECIBIDOR NO SE ELIGE DE UNA LISTA ABIERTA. Se muestran los que el usuario tiene
 * asignados desde el web, y si tiene uno solo —el caso normal— se selecciona solo. Que
 * la app no permita escribir un recibidor cualquiera es deliberado: el recibidor decide
 * qué productores bajan y con qué precios, así que elegir el equivocado no da error,
 * da datos equivocados.
 */
export function ContextoScreen() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaContexto[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [recibidor, setRecibidor] = useState<string | null>(null);
  const [cosecha, setCosecha] = useState<string | null>(null);

  const elegir = useSesion((s) => s.elegir);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    void (async () => {
      try {
        const { empresas } = await cargarContexto();
        const utiles = empresas.filter((e) => !e.sinAccesoRc);
        setEmpresas(utiles);

        // Con una sola opción no se pregunta. El recibidor con un solo asignado es el
        // caso normal, y hacer tocar tres veces algo que no tiene alternativa es
        // fricción pura en una pantalla que se usa a las cinco de la mañana.
        if (utiles.length === 1) {
          const e = utiles[0]!;
          setEmpresaId(e.id);
          if (e.recibidores.length === 1) setRecibidor(e.recibidores[0]!.codigo);
          setCosecha(e.cosechaDefault ?? null);
        }
      } catch (e) {
        setError(
          (e as Error)?.message ??
            "No se pudo traer el contexto. Se necesita conexión la primera vez."
        );
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  const empresa = empresas.find((e) => e.id === empresaId) ?? null;
  const listo = empresaId != null && recibidor != null && cosecha != null;

  const confirmar = async () => {
    if (!listo || !empresa) return;
    const r = empresa.recibidores.find((x) => x.codigo === recibidor);
    await elegir({
      companyId: empresa.id,
      cosecha: cosecha!,
      recibidor: recibidor!,
      recibidorNombre: r?.nombre ?? null,
    });
  };

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={cliente.acento} />
        <Text style={estilos.loadingText}>Cargando contexto...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={estilos.root} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ padding: 20, gap: 4 }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colores.texto }}>
          ¿Dónde vas a recibir?
        </Text>
        <Text style={{ color: colores.textoTenue, fontSize: 14 }}>
          Se pregunta una sola vez. Después la app entra directo.
        </Text>
      </View>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      {empresas.length === 0 && !error ? (
        <Text style={estilos.error}>
          Tu usuario no tiene acceso a recibos en ninguna empresa. Hay que asignarlo
          desde el web, en la pestaña Zonas RC del usuario.
        </Text>
      ) : null}

      {empresas.length > 1 ? (
        <Seccion titulo="Empresa">
          {empresas.map((e) => (
            <Opcion
              key={e.id}
              titulo={e.nombre}
              activa={e.id === empresaId}
              onPress={() => {
                setEmpresaId(e.id);
                setRecibidor(e.recibidores.length === 1 ? e.recibidores[0]!.codigo : null);
                setCosecha(e.cosechaDefault ?? null);
              }}
            />
          ))}
        </Seccion>
      ) : null}

      {empresa ? (
        <Seccion titulo="Recibidor">
          {empresa.recibidores.length === 0 ? (
            <Text style={estilos.error}>
              No tenés ningún recibidor asignado. Sin eso la app no puede saber qué
              productores bajar ni con qué precios trabajar — hay que asignarlo desde el
              web, en la pestaña Zonas RC del usuario.
            </Text>
          ) : (
            empresa.recibidores.map((r) => (
              <Opcion
                key={r.codigo}
                titulo={r.nombre}
                detalle={r.codigo}
                activa={r.codigo === recibidor}
                onPress={() => setRecibidor(r.codigo)}
              />
            ))
          )}
        </Seccion>
      ) : null}

      {empresa ? (
        <Seccion titulo="Cosecha">
          {empresa.cosechas.map((c) => (
            <Opcion
              key={c.codigo}
              titulo={c.codigo}
              detalle={c.descripcion ?? undefined}
              activa={c.codigo === cosecha}
              onPress={() => setCosecha(c.codigo)}
            />
          ))}
        </Seccion>
      ) : null}

      <View style={{ padding: 20, gap: 12 }}>
        <TouchableOpacity
          onPress={confirmar}
          disabled={!listo}
          style={{
            backgroundColor: listo ? cliente.chrome : colores.borde,
            borderRadius: 10,
            minHeight: 50,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: listo ? "#f1f5f9" : colores.textoTenue,
              fontWeight: "700",
              fontSize: 16,
            }}
          >
            Empezar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={logout}
          style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: colores.textoTenue, fontSize: 14 }}>Cerrar sesión</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Seccion({ titulo, children }: Readonly<{ titulo: string; children: React.ReactNode }>) {
  return (
    <View>
      <Text style={estilos.seccion}>{titulo}</Text>
      {children}
    </View>
  );
}

function Opcion({
  titulo,
  detalle,
  activa,
  onPress,
}: Readonly<{ titulo: string; detalle?: string; activa: boolean; onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        estilos.fila,
        activa ? { borderLeftWidth: 4, borderLeftColor: cliente.chrome } : null,
      ]}
    >
      <Text style={estilos.filaTitulo}>{titulo}</Text>
      {detalle ? <Text style={estilos.filaSubtitulo}>{detalle}</Text> : null}
    </TouchableOpacity>
  );
}
