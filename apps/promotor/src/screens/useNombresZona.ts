import { useEffect, useState } from "react";
import { Zona } from "../db/models";
import { database } from "../lib/db";

/**
 * Mapa código de zona → nombre ("5" → "MIRAMAR").
 *
 * Las zonas viajan en los datos por código (rc_solicitud.zona, ge_Socio.rc_zona),
 * pero al promotor el código no le dice nada. Son ~7 filas, así que se cargan
 * enteras en memoria en vez de resolver una por una.
 */
export function useNombresZona(): Map<string, string> {
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const sub = database
      .get<Zona>("zonas")
      .query()
      .observe()
      .subscribe((rows) => {
        setNombres(new Map(rows.map((z) => [z.codigo.trim(), z.displayName])));
      });
    return () => sub.unsubscribe();
  }, []);

  return nombres;
}

/** Etiqueta de una zona: su nombre, o el código si el catálogo aún no bajó. */
export function etiquetaZona(
  nombres: Map<string, string>,
  codigo: string | null | undefined
): string {
  const c = codigo?.trim();
  if (!c) return "—";
  return nombres.get(c) ?? c;
}
