import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Q } from "@nozbe/watermelondb";
import { PendingUpload, Recibidor, TipoVisita, Visita } from "../db/models";
import { database } from "../lib/db";
import { useSesion } from "../lib/sesion";
import { esEditable } from "../lib/politicas";
import { colores, estilos, fmtFecha } from "./estilos";
import { useNombresProductor } from "./useNombresProductor";
import { EstadoPush } from "./EstadoPush";

/**
 * Detalle de una visita: sus datos, editar mientras no subió, y las fotos.
 *
 * Antes la lista iba directo a la cámara, así que una visita no se podía ni
 * revisar ni corregir — sólo fotografiar. Un toque más para llegar a la cámara,
 * pero la visita pasa a tener una pantalla donde vive.
 */
export function VisitaDetailScreen({
  route,
  navigation,
}: Readonly<{ route: any; navigation: any }>) {
  const { visitaId } = route.params as { visitaId: string };

  const [visita, setVisita] = useState<Visita | null>(null);
  const [tipo, setTipo] = useState<TipoVisita | null>(null);
  const [recibidorNombre, setRecibidorNombre] = useState<string | null>(null);
  const [fotos, setFotos] = useState<PendingUpload[]>([]);
  const [cargando, setCargando] = useState(true);
  const nombres = useNombresProductor();
  const politicas = useSesion((s) => s.politicas);

  useEffect(() => {
    let cancelado = false;

    database
      .get<Visita>("visitas")
      .find(visitaId)
      .then(async (v) => {
        if (cancelado) return;
        setVisita(v);
        setCargando(false);

        // Tipo y recibidor se resuelven a mano porque son códigos, no relaciones
        // de WMDB — el catálogo vive en otra tabla local.
        try {
          const tipos = await database
            .get<TipoVisita>("tipos_visita")
            .query(Q.where("id", String(v.idTipoVisita)))
            .fetch();
          if (!cancelado && tipos.length > 0) setTipo(tipos[0]!);
        } catch {
          /* el catálogo puede no haber bajado todavía */
        }

        if (v.recibidor) {
          try {
            const rs = await database
              .get<Recibidor>("recibidores")
              .query(Q.where("codigo", v.recibidor.trim()))
              .fetch();
            if (!cancelado && rs.length > 0) setRecibidorNombre(rs[0]!.displayName);
          } catch {
            /* idem */
          }
        }
      })
      .catch(() => !cancelado && setCargando(false));

    const sub = database
      .get<PendingUpload>("pending_uploads")
      .query(
        Q.where("coleccion", "visitas"),
        Q.where("registro_local_id", visitaId)
      )
      .observe()
      .subscribe(setFotos);

    return () => {
      cancelado = true;
      sub.unsubscribe();
    };
  }, [visitaId]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (!visita) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>
          La visita ya no está en el cache local.
        </Text>
      </View>
    );
  }

  const v = visita;
  const editable = esEditable(politicas, "visitas", v);
  const enviadas = fotos.filter((f) => f.yaSubio).length;
  const enCola = fotos.length - enviadas;

  return (
    <ScrollView style={estilos.root}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <EstadoPush fila={v} />
      </View>

      <Text style={estilos.seccion}>Visita</Text>
      <Dato etiqueta="Tipo" valor={tipo?.nombre ?? `Tipo ${v.idTipoVisita}`} />
      <Dato etiqueta="Fecha" valor={fmtFecha(v.fecha)} />
      <Dato etiqueta="Cosecha" valor={v.cosecha?.trim()} />

      {/* Qué se muestra depende del destino del tipo, igual que en el form. */}
      {v.idSocio != null ? (
        <Dato
          etiqueta="Productor"
          valor={nombres.get(v.idSocio) ?? `Socio #${v.idSocio}`}
        />
      ) : null}
      {v.recibidor ? (
        <Dato etiqueta="Recibidor" valor={recibidorNombre ?? v.recibidor.trim()} />
      ) : null}
      {v.idFinca != null ? <Dato etiqueta="Finca" valor={`#${v.idFinca}`} /> : null}

      <Dato
        etiqueta="Prod. estimada"
        valor={
          v.prodEstimadaPromotor != null ? String(v.prodEstimadaPromotor) : null
        }
      />
      <Dato
        etiqueta="GPS"
        valor={
          v.tieneGps
            ? `📍 ${v.gpsLat!.toFixed(5)}, ${v.gpsLng!.toFixed(5)}`
            : "sin coordenadas"
        }
      />

      <Text style={estilos.seccion}>Observaciones</Text>
      <View style={estilos.detalleFila}>
        <Text style={[estilos.detalleValor, { textAlign: "left", flex: 1 }]}>
          {v.observaciones?.trim() || "—"}
        </Text>
      </View>

      <Text style={estilos.seccion}>Acciones</Text>

      {editable ? (
        <Accion
          texto="✎ Editar visita"
          onPress={() => navigation.navigate("NuevaVisita", { visitaId: v.id })}
        />
      ) : (
        <View style={estilos.vacio}>
          <Text style={estilos.vacioTexto}>
            Ya sincronizada: los cambios se hacen desde el ERP web.
          </Text>
        </View>
      )}

      {/* Los adjuntos se pueden sumar SIEMPRE, sincronizada o no: suben contra el
          id de servidor de la visita y no modifican la visita en sí. */}
      <Accion
        texto={
          fotos.length === 0
            ? "📷 Agregar fotos"
            : `📷 Fotos (${enviadas} enviada(s)${enCola > 0 ? `, ${enCola} en cola` : ""})`
        }
        onPress={() =>
          navigation.navigate("Adjuntos", {
            coleccion: "visitas",
            registroLocalId: v.id,
            titulo: "Tomar foto",
          })
        }
      />

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

function Accion({
  texto,
  onPress,
}: Readonly<{ texto: string; onPress: () => void }>) {
  return (
    <TouchableOpacity style={[estilos.fila, { alignItems: "center" }]} onPress={onPress}>
      <Text style={{ color: colores.primario, fontSize: 16, fontWeight: "700" }}>
        {texto}
      </Text>
    </TouchableOpacity>
  );
}

function Dato({
  etiqueta,
  valor,
}: Readonly<{ etiqueta: string; valor?: string | null }>) {
  return (
    <View style={estilos.detalleFila}>
      <Text style={estilos.detalleEtiqueta}>{etiqueta}</Text>
      <Text style={estilos.detalleValor}>{valor || "—"}</Text>
    </View>
  );
}
