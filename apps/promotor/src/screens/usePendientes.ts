import { useEffect, useState } from "react";
import { Q } from "@nozbe/watermelondb";
import { database } from "../lib/db";

/**
 * Cuántas filas creadas en el teléfono todavía no subieron, en vivo.
 *
 * Existe porque se sacó el sync automático al guardar: una solicitud sólo se
 * puede editar mientras no subió, y sincronizar apenas se guardaba la volvía de
 * solo lectura en segundos. Ahora sincroniza el promotor cuando termina de
 * capturar — pero entonces hace falta que vea qué le queda pendiente, o se va del
 * cafetal con trabajo sin enviar.
 */
const TABLAS = ["solicitudes", "entregadores", "visitas"] as const;

export function usePendientes(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const contadores = new Map<string, number>();

    const actualizar = () =>
      setTotal([...contadores.values()].reduce((a, b) => a + b, 0));

    const subs = TABLAS.map((tabla) =>
      database
        .get(tabla)
        .query(Q.where("_status", Q.notEq("synced")))
        .observeCount()
        .subscribe((n) => {
          contadores.set(tabla, n);
          actualizar();
        })
    );

    // Las fotos en cola también cuentan: viven en una tabla local que el reset
    // por cambio de cosecha borra, y sin subir se pierden con sus archivos.
    subs.push(
      database
        .get("pending_uploads")
        .query()
        .observeCount()
        .subscribe((n) => {
          contadores.set("pending_uploads", n);
          actualizar();
        })
    );

    return () => subs.forEach((s) => s.unsubscribe());
  }, []);

  return total;
}
