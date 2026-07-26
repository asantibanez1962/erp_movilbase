import { useEffect, useState } from "react";
import { Productor } from "../db/models";
import { database } from "../lib/db";

/**
 * Mapa IdSocio → nombre para mostrar. Las listas de solicitudes y visitas
 * guardan el id numérico del productor, no su nombre; resolverlo fila por fila
 * dispararía una query por item. El cache local es de cientos de productores,
 * así que cargarlo entero en memoria una vez es más barato y más simple.
 */
export function useNombresProductor(): Map<number, string> {
  const [nombres, setNombres] = useState<Map<number, string>>(new Map());

  useEffect(() => {
    const sub = database
      .get<Productor>("productores")
      .query()
      .observe()
      .subscribe((rows) => {
        const mapa = new Map<number, string>();
        for (const p of rows) {
          const idSocio = Number(p.id);
          if (!Number.isNaN(idSocio)) mapa.set(idSocio, p.displayName);
        }
        setNombres(mapa);
      });
    return () => sub.unsubscribe();
  }, []);

  return nombres;
}
