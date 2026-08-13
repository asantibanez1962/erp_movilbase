import { useEffect, useState } from "react";
import { database } from "../lib/db";
import type { Nivel, TipoCafe, Transportista } from "../db/models";

/**
 * Los nombres de los catálogos que se muestran en más de una pantalla.
 *
 * Existe porque el mismo error apareció tres veces en tres pantallas distintas: mostrar
 * `2` donde va "DIF O-01", o `27` donde va "CASTRO HERNANDEZ OSCAR ALEJANDRO". Las
 * columnas guardan códigos y en el formulario se elige por nombre, así que cualquier
 * pantalla que muestre el valor crudo enseña algo que el recibidor no reconoce — y no da
 * ningún error, se ve raro y ya.
 *
 * Se resuelve en un solo lugar para que la próxima pantalla no lo vuelva a repetir.
 */
export interface Catalogos {
  tipoCafe: (codigo: string | null | undefined) => string;
  transportista: (codigo: string | null | undefined) => string;
  nivel: (nivel: number | null | undefined) => string;
}

export function useCatalogos(): Catalogos {
  const [tipos, setTipos] = useState<TipoCafe[]>([]);
  const [transportistas, setTransportistas] = useState<Transportista[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [tc, tr, nv] = await Promise.all([
        database.get<TipoCafe>("tipos_cafe").query().fetch(),
        database.get<Transportista>("transportistas").query().fetch(),
        database.get<Nivel>("niveles").query().fetch(),
      ]);
      if (!vivo) return;
      setTipos(tc);
      setTransportistas(tr);
      setNiveles(nv);
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Si el catálogo todavía no bajó se devuelve el código: es peor mostrar un vacío, que
  // parece un dato faltante, que un código que al menos identifica la fila.
  const buscar = <T,>(
    lista: T[],
    coincide: (x: T) => boolean,
    nombre: (x: T) => string | null,
    crudo: string
  ) => (crudo ? (lista.find(coincide) && nombre(lista.find(coincide)!)) || crudo : "—");

  return {
    tipoCafe: (codigo) => {
      const c = (codigo ?? "").trim();
      return buscar(tipos, (t) => t.tipocafe.trim() === c, (t) => t.nombre, c);
    },
    transportista: (codigo) => {
      const c = (codigo ?? "").trim();
      return buscar(
        transportistas,
        (t) => t.transportista.trim() === c,
        (t) => t.nombre,
        c
      );
    },
    nivel: (n) =>
      n == null ? "—" : (niveles.find((x) => x.nivel === n)?.nombre ?? String(n)),
  };
}
