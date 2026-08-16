import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore } from "@erp/shared-api";
import { cliente } from "../branding";
import {
  cargarContexto,
  type CosechaOpcion,
  type EmpresaContexto,
} from "../lib/contexto";
import { useSesion } from "../lib/sesion";
import { PickerModal } from "./Picker";
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
/**
 * Las cosechas en las que el servidor ACEPTA recibos, de mayor a menor.
 *
 * ⚠️ El filtro y el default tienen que usar esta misma función. Si el default del web
 * apunta a una cosecha filtrada —que es justo lo que pasa hoy: la preferencia de andrea
 * es 2026-2027 y ésa no digita— quedaría elegida pero fuera de la lista, y al abrir el
 * desplegable no se podría volver a ella. Un valor que la pantalla muestra y no ofrece.
 *
 * `?? true` porque un servidor viejo no manda el campo: sin eso, actualizar el APK contra
 * un BE desactualizado dejaría la lista vacía y nadie podría entrar.
 *
 * El código es `2025-2026`, así que el orden de texto descendente ya es el cronológico
 * inverso — no hace falta parsear el año.
 */
function cosechasUtiles(e: EmpresaContexto | null): CosechaOpcion[] {
  return [...(e?.cosechas ?? [])]
    .filter((c) => c.permiteRecibos ?? true)
    .sort((a, b) => b.codigo.localeCompare(a.codigo));
}

/**
 * El default que el usuario tiene configurado en el web, SÓLO si sirve para recibir.
 *
 * Se respeta la preferencia —es la que la persona eligió— pero no se acepta a ciegas: una
 * que no digita deja al recibidor sin talonarios, sin precios y sin niveles, y el síntoma
 * ("no hay talonario para este recibidor") no se parece en nada a la causa. Mejor sin
 * elegir, que obliga a mirar la lista.
 */
function cosechaInicial(e: EmpresaContexto): string | null {
  const def = e.cosechaDefault ?? null;
  return def && cosechasUtiles(e).some((c) => c.codigo === def) ? def : null;
}

export function ContextoScreen() {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaContexto[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [recibidor, setRecibidor] = useState<string | null>(null);
  const [cosecha, setCosecha] = useState<string | null>(null);
  const [pickerCosecha, setPickerCosecha] = useState(false);

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
          setCosecha(cosechaInicial(e));
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

  /**
   * De mayor a menor. El código es `2025-2026`, así que el orden de texto descendente ya
   * es el cronológico inverso — no hace falta parsear el año.
   */
  const cosechasOrdenadas = useMemo(() => cosechasUtiles(empresa), [empresa]);

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
                setCosecha(cosechaInicial(e));
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

      {/*
        La cosecha va en un desplegable y no en una lista abierta, que es la diferencia
        entre elegir y scrollear: son ocho o más, todas se llaman casi igual
        (`2025-2026`, `2024-2025`, …) y sólo una se usa. Desplegadas empujaban el botón
        de Empezar fuera de la pantalla justo cuando ya no había nada más que decidir.

        Ordenadas de mayor a menor ACÁ y no confiando en el servidor: la que se necesita
        es siempre la última, y que quede arriba es la mitad del valor de esta pantalla.
      */}
      {empresa ? (
        <Seccion titulo="Cosecha">
          <Desplegable
            valor={cosecha ?? "Elegir cosecha"}
            detalle={cosechasOrdenadas.find((c) => c.codigo === cosecha)?.descripcion ?? undefined}
            vacio={cosecha == null}
            onPress={() => setPickerCosecha(true)}
          />
        </Seccion>
      ) : null}

      <PickerModal
        visible={pickerCosecha}
        titulo="Cosecha"
        // Sin buscador: son ocho renglones y el teclado taparía la lista entera.
        conBuscador={false}
        opciones={cosechasOrdenadas.map((c) => ({
          valor: c.codigo,
          titulo: c.codigo,
          subtitulo: c.descripcion ?? undefined,
        }))}
        onSeleccionar={setCosecha}
        onCerrar={() => setPickerCosecha(false)}
      />

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

/** Fila desplegable: muestra lo elegido y abre la lista al tocarla. */
function Desplegable({
  valor,
  detalle,
  vacio,
  onPress,
}: Readonly<{ valor: string; detalle?: string; vacio?: boolean; onPress: () => void }>) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[estilos.fila, { flexDirection: "row", alignItems: "center", gap: 10 }]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            estilos.filaTitulo,
            vacio ? { color: colores.textoTenue, fontWeight: "400" } : null,
          ]}
        >
          {valor}
        </Text>
        {detalle ? <Text style={estilos.filaSubtitulo}>{detalle}</Text> : null}
      </View>
      {/* El triangulito que dice "esto se despliega". Sin él la fila se lee como un
          renglón informativo y nadie la toca. */}
      <Text style={{ color: colores.textoTenue, fontSize: 12 }}>▼</Text>
    </TouchableOpacity>
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
