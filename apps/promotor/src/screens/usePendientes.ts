import { useEffect, useState } from "react";
import { Q } from "@nozbe/watermelondb";
import { database } from "../lib/db";
import { useSesion } from "../lib/sesion";
import { politicaDe } from "../lib/politicas";

/**
 * Trabajo del teléfono que todavía no llegó al servidor, separado en dos.
 *
 * La distinción importa: si se muestra un solo número, el usuario sincroniza,
 * el contador no baja a cero y no entiende por qué. Son dos situaciones muy
 * distintas:
 *
 *   porEnviar  → depende de él: sincroniza y se va.
 *   retenidas  → NO puede hacer nada sincronizando. La fila espera un evento de
 *                negocio (política hasta-evento: un recibo sin imprimir). Hay que
 *                cerrarla primero.
 *
 * Existe además porque se sacó el sync automático al guardar: sin un indicador
 * visible, el promotor se va del campo con trabajo sin enviar.
 */
const TABLAS = ["solicitudes", "entregadores", "visitas"] as const;

export interface Pendientes {
  porEnviar: number;
  retenidas: number;
  total: number;
  /**
   * `true` hasta que las consultas contestaron por primera vez.
   *
   * Los contadores arrancan en 0 y ese 0 NO es una medición: es el valor inicial
   * mientras WatermelonDB responde. Para el badge del drawer da lo mismo —se ve
   * 0 por un instante—, pero quien use estos números para DECIDIR algo tiene que
   * poder distinguir "no hay nada pendiente" de "todavía no sé".
   *
   * Lo pide la puerta del cambio de clave (App.tsx): ahí 0 significa "exigí la
   * clave ahora", y sin este flag la pantalla parpadeaba sobre la app antes de
   * que llegara el conteo real.
   */
  cargando: boolean;
}

export function usePendientes(): Pendientes {
  const politicas = useSesion((s) => s.politicas);
  const [pend, setPend] = useState<Pendientes>({
    porEnviar: 0,
    retenidas: 0,
    total: 0,
    cargando: true,
  });

  useEffect(() => {
    const sinSync = new Map<string, number>();
    const retenidas = new Map<string, number>();

    const actualizar = () => {
      const sumar = (m: Map<string, number>) =>
        [...m.values()].reduce((a, b) => a + b, 0);
      const totalSinSync = sumar(sinSync);
      const totalRetenidas = sumar(retenidas);
      setPend({
        porEnviar: Math.max(totalSinSync - totalRetenidas, 0),
        retenidas: totalRetenidas,
        total: totalSinSync,
        cargando: false,
      });
    };

    const subs = TABLAS.map((tabla) =>
      database
        .get(tabla)
        .query(Q.where("_status", Q.notEq("synced")))
        .observeCount()
        .subscribe((n) => {
          sinSync.set(tabla, n);
          actualizar();
        })
    );

    // Retenidas: sólo aplica a colecciones con política hasta-evento, que hoy no
    // hay ninguna. El loop queda listo para cuando entren los recibos.
    for (const tabla of TABLAS) {
      const { politica, campoCierre } = politicaDe(politicas, tabla);
      if (politica !== "hasta-evento" || !campoCierre) {
        retenidas.set(tabla, 0);
        continue;
      }
      subs.push(
        database
          .get(tabla)
          .query(Q.where("_status", Q.notEq("synced")), Q.where(campoCierre, null))
          .observeCount()
          .subscribe((n) => {
            retenidas.set(tabla, n);
            actualizar();
          })
      );
    }

    // Las fotos en cola cuentan como por enviar: viven en una tabla local que el
    // reset por cambio de cosecha borra, y sin subir se pierden con sus archivos.
    subs.push(
      database
        .get("pending_uploads")
        .query(Q.where("status", Q.notEq("subida")))
        .observeCount()
        .subscribe((n) => {
          sinSync.set("pending_uploads", n);
          actualizar();
        })
    );

    return () => subs.forEach((s) => s.unsubscribe());
  }, [politicas]);

  return pend;
}
