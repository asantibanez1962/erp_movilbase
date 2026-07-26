import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { Q } from "@nozbe/watermelondb";
import { Finca, Productor, Solicitud, Visita } from "../db/models";
import { database } from "../lib/db";
import { colores, estilos, fmtFecha, fmtMoneda } from "./estilos";

/**
 * Ficha del productor: sus datos + sus fincas + sus solicitudes + sus visitas.
 * Todo del cache local, sin red — es la pantalla que el promotor abre parado
 * en el cafetal.
 */
export function ProductorDetailScreen({ route }: Readonly<{ route: any }>) {
  const { productorId } = route.params as { productorId: string };

  const [productor, setProductor] = useState<Productor | null>(null);
  const [fincas, setFincas] = useState<Finca[]>([]);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;

    database
      .get<Productor>("productores")
      .find(productorId)
      .then((p) => {
        if (cancelado) return;
        setProductor(p);
        setCargando(false);
      })
      .catch(() => !cancelado && setCargando(false));

    return () => {
      cancelado = true;
    };
  }, [productorId]);

  // Las tres listas hijas se cuelgan del IdSocio, que sólo conocemos después de
  // resolver el productor (su id local ES el IdSocio, pero como string).
  useEffect(() => {
    if (!productor) return;
    const idSocio = Number(productor.id);
    if (Number.isNaN(idSocio)) return;

    const subs = [
      database
        .get<Finca>("fincas")
        .query(Q.where("id_socio", idSocio))
        .observe()
        .subscribe(setFincas),
      database
        .get<Solicitud>("solicitudes")
        .query(Q.where("id_socio", idSocio), Q.sortBy("fecha", Q.desc))
        .observe()
        .subscribe(setSolicitudes),
      database
        .get<Visita>("visitas")
        .query(Q.where("id_socio", idSocio), Q.sortBy("fecha", Q.desc))
        .observe()
        .subscribe(setVisitas),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
  }, [productor]);

  if (cargando) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <ActivityIndicator size="large" color={colores.primario} />
      </View>
    );
  }

  if (!productor) {
    return (
      <View style={[estilos.root, estilos.center]}>
        <Text style={estilos.vacioTexto}>
          El productor ya no está en el cache local.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={estilos.root}>
      <Text style={estilos.seccion}>Datos</Text>
      <Dato etiqueta="Nombre" valor={productor.displayName} />
      <Dato etiqueta="Código" valor={productor.codigo?.trim()} />
      <Dato etiqueta="Identificación" valor={productor.identificacion?.trim()} />
      <Dato etiqueta="Teléfonos" valor={productor.telefonos?.trim()} />
      <Dato etiqueta="Email" valor={productor.email?.trim()} />

      <Text style={estilos.seccion}>Fincas ({fincas.length})</Text>
      {fincas.length === 0 ? (
        <Vacio texto="Sin fincas registradas." />
      ) : (
        fincas.map((f) => (
          <View key={f.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>{f.displayName}</Text>
            <Text style={estilos.filaSubtitulo}>
              {[
                f.ubicacion?.trim(),
                f.area != null ? `${f.area} ha` : null,
                f.altitud != null ? `${f.altitud} msnm` : null,
              ]
                .filter(Boolean)
                .join(" · ") || "sin detalle"}
            </Text>
          </View>
        ))
      )}

      <Text style={estilos.seccion}>Solicitudes ({solicitudes.length})</Text>
      {solicitudes.length === 0 ? (
        <Vacio texto="Sin solicitudes de crédito." />
      ) : (
        solicitudes.map((s) => (
          <View key={s.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>
              {fmtMoneda(s.total)} · {s.cosecha?.trim() || "sin cosecha"}
            </Text>
            <Text style={estilos.filaSubtitulo}>{fmtFecha(s.fecha)}</Text>
          </View>
        ))
      )}

      <Text style={estilos.seccion}>Visitas ({visitas.length})</Text>
      {visitas.length === 0 ? (
        <Vacio texto="Sin visitas registradas." />
      ) : (
        visitas.map((v) => (
          <View key={v.id} style={estilos.fila}>
            <Text style={estilos.filaTitulo}>{fmtFecha(v.fecha)}</Text>
            <Text style={estilos.filaSubtitulo} numberOfLines={2}>
              {v.observaciones?.trim() || "sin observaciones"}
            </Text>
          </View>
        ))
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
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

function Vacio({ texto }: Readonly<{ texto: string }>) {
  return (
    <View style={estilos.vacio}>
      <Text style={estilos.vacioTexto}>{texto}</Text>
    </View>
  );
}
