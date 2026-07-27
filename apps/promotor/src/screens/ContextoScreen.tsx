import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuthStore } from "@erp/shared-api";
import { cargarContexto, type EmpresaContexto } from "../lib/contexto";
import { pedirPermisosDeCampo } from "../lib/permisos";
import { cerrarSesion } from "../lib/alcance";
import { useSesion } from "../lib/sesion";
import { syncNow } from "../lib/sync";
import { colores, estilos } from "./estilos";
import { PickerModal } from "./componentes/Picker";
import { BotonPrimario, CampoSeleccion } from "./componentes/Campos";

/**
 * Contexto de trabajo, entre el login y la app. Pide empresa y cosecha porque el
 * sync no puede arrancar sin las dos:
 *
 *   - la EMPRESA determina las zonas autorizadas del usuario (rc_usuario_zona es
 *     por user × empresa), o sea el alcance de todo lo que baja
 *   - la COSECHA recorta solicitudes y visitas (~236 filas contra 2 142)
 *
 * Las zonas se muestran pero no se eligen: son autorización, las resuelve el BE
 * desde el JWT. Si el usuario no tiene acceso RC en una empresa, esa empresa se
 * marca como no disponible en vez de dejarlo entrar a una sesión que no traería
 * ni una fila.
 */
/**
 * Zonas por NOMBRE, no por código: al promotor "MIRAMAR" le dice algo y "5" no.
 * El código se sigue usando internamente porque es lo que viaja en los datos.
 */
function describirZonas(e: EmpresaContexto): string {
  if (e.sinAccesoRc) return "Sin acceso al módulo de crédito";
  if (e.todasLasZonas) return "Todas las zonas";
  const nombres = (e.zonasNombres ?? []).map((z) => z.nombre);
  return `Zonas: ${(nombres.length > 0 ? nombres : e.zonas).join(", ")}`;
}

export function ContextoScreen() {
  const [empresas, setEmpresas] = useState<EmpresaContexto[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [cosecha, setCosecha] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<"empresa" | "cosecha" | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [retencionDias, setRetencionDias] = useState(30);

  const elegir = useSesion((s) => s.elegir);
  const logout = useAuthStore((s) => s.logout);

  useEffect(() => {
    let cancelado = false;
    cargarContexto()
      .then(({ empresas: lista, retencionFotosLocalesDias }) => {
        if (cancelado) return;
        setEmpresas(lista);
        setRetencionDias(retencionFotosLocalesDias);
        // Con una sola empresa disponible no tiene sentido preguntar.
        const usables = lista.filter((e) => !e.sinAccesoRc);
        const unica = usables.length === 1 ? usables[0] : undefined;
        if (unica) {
          setEmpresaId(unica.id);
          setCosecha(unica.cosechaDefault ?? null);
        }
        setCargando(false);
      })
      .catch((e) => {
        if (cancelado) return;
        setError(
          (e as Error)?.message ??
            "No se pudo cargar el contexto. Necesitás conexión la primera vez."
        );
        setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, []);

  const empresa = empresas.find((e) => e.id === empresaId);

  // Cambiar de empresa invalida la cosecha: el catálogo y el default son suyos.
  useEffect(() => {
    if (empresa) setCosecha(empresa.cosechaDefault ?? null);
  }, [empresaId]);

  const opcionesEmpresa = useMemo(
    () =>
      empresas.map((e) => ({
        valor: String(e.id),
        titulo: e.nombre,
        subtitulo: describirZonas(e),
      })),
    [empresas]
  );

  const opcionesCosecha = useMemo(
    () =>
      (empresa?.cosechas ?? []).map((c) => ({
        valor: c.codigo,
        titulo: c.codigo,
        subtitulo: c.descripcion && c.descripcion !== c.codigo ? c.descripcion : undefined,
      })),
    [empresa]
  );

  const sinAcceso = empresa?.sinAccesoRc === true;
  const puedeEntrar = empresa != null && !sinAcceso && !!cosecha && !guardando;

  const entrar = async () => {
    if (!puedeEntrar || !empresa || !cosecha) return;
    setGuardando(true);
    try {
      // Los permisos de ubicación y cámara se piden ACÁ, una vez, antes de entrar:
      // el promotor está eligiendo contexto —normalmente bajo techo y con las manos
      // libres—, no en medio de una visita. Pedirlos durante la captura hace que se
      // toque "Solo esta vez" para sacarse el diálogo de encima, y ése Android lo
      // revoca al rato: de ahí la sensación de que pregunta siempre.
      //
      // No bloquea: si los niega, igual entra. Sin cámara se sigue capturando
      // visitas y solicitudes, que es el trabajo principal.
      await pedirPermisosDeCampo();

      await elegir({
        companyId: empresa.id,
        cosecha,
        zonas: empresa.zonas,
        zonasNombres: (empresa.zonasNombres ?? []).map((z) => z.nombre),
        todasLasZonas: empresa.todasLasZonas,
        retencionFotosDias: retencionDias,
      });

      // Primer sync: ACÁ y no en el login, porque el pull está scopeado por
      // empresa y cosecha y recién ahora existen. Antes se disparaba al loguearse
      // y el BE devolvía 400 MISSING_COMPANY.
      //
      // Best-effort y sin await: el promotor suele elegir contexto en la oficina
      // con WiFi, pero si no hay red igual tiene que poder entrar y trabajar con
      // lo que ya tenga en cache.
      syncNow().catch((err) =>
        console.warn("sync inicial falló", (err as Error)?.message)
      );
    } catch (e) {
      setError((e as Error)?.message ?? "No se pudo guardar la selección");
      setGuardando(false);
    }
  };

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center, { flex: 1 }]}>
        <ActivityIndicator size="large" color={colores.primario} />
        <Text style={estilos.loadingText}>Cargando contexto de trabajo...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={estilos.root} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={estilos.seccion}>Contexto de trabajo</Text>

      {error ? <Text style={estilos.error}>⚠ {error}</Text> : null}

      {empresas.length === 0 ? (
        <View style={estilos.vacio}>
          <Text style={estilos.vacioTexto}>
            Tu usuario no tiene empresas habilitadas. Coordiná con el administrador.
          </Text>
        </View>
      ) : (
        <>
          <CampoSeleccion
            etiqueta="Empresa"
            requerido
            valorMostrado={empresa?.nombre ?? null}
            onAbrir={() => setAbierto("empresa")}
          />

          {empresa ? (
            <View style={estilos.detalleFila}>
              <Text style={estilos.detalleEtiqueta}>Zonas autorizadas</Text>
              <Text
                style={[
                  estilos.detalleValor,
                  { color: sinAcceso ? colores.error : colores.texto },
                ]}
              >
                {describirZonas(empresa).replace(/^Zonas: /, "")}
              </Text>
            </View>
          ) : null}

          <CampoSeleccion
            etiqueta="Cosecha"
            requerido
            deshabilitado={empresa == null || sinAcceso}
            valorMostrado={cosecha}
            onAbrir={() => setAbierto("cosecha")}
          />

          <Text
            style={[
              estilos.vacioTexto,
              { paddingHorizontal: 16, paddingTop: 8, textAlign: "left" },
            ]}
          >
            Trabajás una cosecha a la vez. Se puede cambiar después desde el menú,
            pero eso vuelve a bajar los datos.
          </Text>

          {sinAcceso ? (
            <Text style={estilos.error}>
              Tu usuario no tiene zonas asignadas en esta empresa, así que no
              recibiría ningún productor ni solicitud. Hay que asignárselas en el
              ERP antes de usar la app.
            </Text>
          ) : null}

          <BotonPrimario
            texto={guardando ? "Entrando..." : "Entrar"}
            onPress={entrar}
            deshabilitado={!puedeEntrar}
          />
        </>
      )}

      {/* Descarta sin preguntar: en esta pantalla todavía no se eligió contexto, así
          que no puede haber trabajo capturado. Lo que sí puede haber son datos de un
          usuario anterior, y esos hay que borrarlos. */}
      <TouchableOpacity
        onPress={() => {
          cerrarSesion({ descartar: true })
            .catch(() => undefined)
            .finally(logout);
        }}
        style={{ padding: 20, alignItems: "center" }}
      >
        <Text style={{ color: colores.textoTenue, fontSize: 14 }}>Cerrar sesión</Text>
      </TouchableOpacity>

      <PickerModal
        visible={abierto === "empresa"}
        titulo="Elegir empresa"
        opciones={opcionesEmpresa}
        onSeleccionar={(v) => setEmpresaId(Number(v))}
        onCerrar={() => setAbierto(null)}
      />
      <PickerModal
        visible={abierto === "cosecha"}
        titulo="Elegir cosecha"
        opciones={opcionesCosecha}
        onSeleccionar={setCosecha}
        onCerrar={() => setAbierto(null)}
      />
    </ScrollView>
  );
}
