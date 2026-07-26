import { useEffect, useState } from "react";
import { Q } from "@nozbe/watermelondb";
import { Finca, Productor, Recibidor, Solicitud, TipoVisita } from "../../db/models";
import { database } from "../../lib/db";
import type { OpcionPicker } from "./Picker";
import { fmtFecha, fmtMoneda } from "../estilos";

/**
 * Hooks que convierten las colecciones locales en opciones de PickerModal.
 * Viven acá y no en cada screen porque productores lo usan tres pantallas y
 * duplicar el mapeo garantiza que se desincronicen.
 */

export function useOpcionesProductor(): OpcionPicker[] {
  const [opciones, setOpciones] = useState<OpcionPicker[]>([]);

  useEffect(() => {
    const sub = database
      .get<Productor>("productores")
      .query(Q.sortBy("nombre", Q.asc))
      .observe()
      .subscribe((rows) => {
        setOpciones(
          rows.map((p) => ({
            valor: p.id,
            titulo: p.displayName,
            subtitulo:
              [p.codigo?.trim(), p.identificacion?.trim()]
                .filter(Boolean)
                .join(" · ") || undefined,
            busqueda: p.searchBlob,
          }))
        );
      });
    return () => sub.unsubscribe();
  }, []);

  return opciones;
}

export function useOpcionesTipoVisita(): { opciones: OpcionPicker[]; tipos: Map<string, TipoVisita> } {
  const [opciones, setOpciones] = useState<OpcionPicker[]>([]);
  const [tipos, setTipos] = useState<Map<string, TipoVisita>>(new Map());

  useEffect(() => {
    const sub = database
      .get<TipoVisita>("tipos_visita")
      .query(Q.sortBy("nombre", Q.asc))
      .observe()
      .subscribe((rows) => {
        setOpciones(
          // El subtítulo dice a QUÉ se visita, para que el promotor sepa qué le
          // va a pedir el form antes de elegir.
          rows.map((t) => {
            const partes = [
              t.destino === "recibidor" ? "recibidor" : undefined,
              t.destino === "productor" ? "productor" : undefined,
              t.destino === "finca" ? "productor y finca" : undefined,
              t.exigeSolicitud ? "solicitud de crédito" : undefined,
            ].filter(Boolean);
            return {
              valor: t.id,
              titulo: t.nombre ?? `Tipo ${t.id}`,
              subtitulo: partes.length > 0 ? partes.join(" · ") : undefined,
            };
          })
        );
        setTipos(new Map(rows.map((t) => [t.id, t])));
      });
    return () => sub.unsubscribe();
  }, []);

  return { opciones, tipos };
}

/**
 * Recibidores, TODOS. No se filtran por zona aunque la tengan: un promotor puede
 * necesitar registrar una visita a un recibidor fuera de su zona, y esconderlos lo
 * dejaría sin poder capturarla.
 */
export function useOpcionesRecibidor(): OpcionPicker[] {
  const [opciones, setOpciones] = useState<OpcionPicker[]>([]);

  useEffect(() => {
    const sub = database
      .get<Recibidor>("recibidores")
      .query(Q.sortBy("codigo", Q.asc))
      .observe()
      .subscribe((rows) => {
        setOpciones(
          rows.map((r) => ({
            valor: r.codigo,
            titulo: r.displayName,
            subtitulo: r.codigo,
            busqueda: `${r.codigo} ${r.nombre ?? ""}`.toLowerCase(),
          }))
        );
      });
    return () => sub.unsubscribe();
  }, []);

  return opciones;
}

/** Fincas del productor elegido. Vacío mientras no haya productor. */
export function useOpcionesFinca(idSocio: number | null): OpcionPicker[] {
  const [opciones, setOpciones] = useState<OpcionPicker[]>([]);

  useEffect(() => {
    if (idSocio == null) {
      setOpciones([]);
      return;
    }
    const sub = database
      .get<Finca>("fincas")
      .query(Q.where("id_socio", idSocio))
      .observe()
      .subscribe((rows) => {
        setOpciones(
          rows.map((f) => ({
            valor: f.id,
            titulo: f.displayName,
            subtitulo:
              [f.ubicacion?.trim(), f.area != null ? `${f.area} ha` : null]
                .filter(Boolean)
                .join(" · ") || undefined,
          }))
        );
      });
    return () => sub.unsubscribe();
  }, [idSocio]);

  return opciones;
}

/**
 * Solicitudes del productor elegido, para ligar la visita de validación de
 * crédito. Incluye las creadas offline: su id local es el mismo valor que el BE
 * va a resolver contra mt.MobileIdMap.
 */
export function useOpcionesSolicitud(idSocio: number | null): OpcionPicker[] {
  const [opciones, setOpciones] = useState<OpcionPicker[]>([]);

  useEffect(() => {
    if (idSocio == null) {
      setOpciones([]);
      return;
    }
    const sub = database
      .get<Solicitud>("solicitudes")
      .query(Q.where("id_socio", idSocio), Q.sortBy("fecha", Q.desc))
      .observe()
      .subscribe((rows) => {
        setOpciones(
          rows.map((s) => ({
            valor: s.id,
            titulo: `${fmtMoneda(s.total)} · ${s.cosecha?.trim() || "sin cosecha"}`,
            subtitulo:
              fmtFecha(s.fecha) + (s.esLocal ? " · pendiente de sincronizar" : ""),
          }))
        );
      });
    return () => sub.unsubscribe();
  }, [idSocio]);

  return opciones;
}
