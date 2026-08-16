import { useEffect, useState } from "react";
import { database } from "../lib/db";
import type { Calidad, Certificado, Nivel, TipoCafe, Transportista } from "../db/models";

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
  calidad: (codigo: string | null | undefined) => string;
  certificado: (id: number | null | undefined) => string | null;
  transportista: (codigo: string | null | undefined) => string;
  nivel: (nivel: number | null | undefined) => string;
}

export function useCatalogos(): Catalogos {
  const [tipos, setTipos] = useState<TipoCafe[]>([]);
  const [calidades, setCalidades] = useState<Calidad[]>([]);
  const [certificados, setCertificados] = useState<Certificado[]>([]);
  const [transportistas, setTransportistas] = useState<Transportista[]>([]);
  const [niveles, setNiveles] = useState<Nivel[]>([]);

  /**
   * ⚠️ SE OBSERVAN, NO SE LEEN UNA VEZ.
   *
   * Antes esto era un `fetch()` al montar. El problema aparece justo después de borrar la
   * base —cambiar recibidor, cerrar sesión, un teléfono nuevo—: los catálogos están
   * vacíos, el hook lee cero filas, y cuando el sync los llena **nadie vuelve a leerlos**.
   * La pantalla se queda mostrando `9` y `4` en vez de CONVENCIONAL y DIF C-01, hasta que
   * el usuario sale y entra a la pantalla.
   *
   * Con `observe()` alcanza y no hace falta `observeWithColumns`: acá lo que cambia es el
   * CONJUNTO —el catálogo pasa de cero filas a tenerlas— y eso `observe()` sí lo avisa.
   */
  useEffect(() => {
    const subs = [
      database.get<TipoCafe>("tipos_cafe").query().observe().subscribe(setTipos),
      database.get<Calidad>("calidades").query().observe().subscribe(setCalidades),
      database.get<Certificado>("certificados").query().observe().subscribe(setCertificados),
      database.get<Transportista>("transportistas").query().observe().subscribe(setTransportistas),
      database.get<Nivel>("niveles").query().observe().subscribe(setNiveles),
    ];
    return () => subs.forEach((s) => s.unsubscribe());
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
    calidad: (codigo) => {
      const c = (codigo ?? "").trim();
      return buscar(calidades, (x) => x.calidad.trim() === c, (x) => x.nombre, c);
    },
    // Devuelve null —y no un guión— cuando el recibo no lleva certificado: la pantalla
    // omite el renglón entero en vez de mostrar un campo vacío que parece dato faltante.
    certificado: (id) =>
      id == null
        ? null
        : (certificados.find((x) => x.idcertificado === id)?.nombre ?? `#${id}`),
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
