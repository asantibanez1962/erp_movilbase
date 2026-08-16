import { Text, TouchableOpacity, View } from "react-native";
import { cliente } from "../branding";
import { colores } from "./estilos";

/**
 * Cuántos días de historia se muestran en una lista.
 *
 * ── POR QUÉ HACE FALTA ──────────────────────────────────────────────────────
 *
 * El trabajo del recibidor es DIARIO: se abre la bitácora, se reciben los recibos, se
 * cierra y se envía. Al día siguiente empieza de nuevo. Pero la lista mostraba todo lo
 * que hubiera pasado por el teléfono desde el principio de la cosecha, y eso son miles
 * de filas —el recibidor 001 lleva 4.168 recibos en la cosecha actual—.
 *
 * Lo que se consulta de verdad es lo de hoy, y a veces lo de ayer para reimprimir algo.
 * Ver mil recibos viejos no ayuda a encontrar el de esta mañana: estorba.
 *
 * `null` = sin límite. Se ofrece igual porque el día que alguien busque un recibo de la
 * semana pasada tiene que poder, y esconder datos que están ahí sería peor que
 * mostrarlos de más.
 */
export type Dias = 1 | 3 | 7 | null;

export const DIAS_POR_DEFECTO: Dias = 1;

/**
 * El instante desde el que se muestra, o null para todo.
 *
 * ⚠️ Se corta por DÍA CALENDARIO y no por "hace 24 horas". Un recibo de ayer a las 6 de
 * la tarde tiene que salir en "3 días" aunque hayan pasado 30 horas: el recibidor piensa
 * en días de trabajo, no en ventanas móviles.
 */
export function desdeCuando(dias: Dias): number | null {
  if (dias == null) return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (dias - 1));
  return d.getTime();
}

export function FiltroDias({
  valor,
  onCambiar,
  cuantas,
}: Readonly<{
  valor: Dias;
  onCambiar: (d: Dias) => void;
  /** Cuántas filas quedaron visibles, para que el filtro rinda cuentas de lo que oculta. */
  cuantas: number;
}>) {
  const opciones: Array<{ d: Dias; texto: string }> = [
    { d: 1, texto: "Hoy" },
    { d: 3, texto: "3 días" },
    { d: 7, texto: "7 días" },
    { d: null, texto: "Todo" },
  ];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: colores.superficie,
        borderBottomWidth: 1,
        borderBottomColor: colores.borde,
      }}
    >
      {opciones.map((o) => {
        const activa = o.d === valor;
        return (
          <TouchableOpacity
            key={o.texto}
            onPress={() => onCambiar(o.d)}
            style={{
              paddingHorizontal: 12,
              minHeight: 34,
              justifyContent: "center",
              borderRadius: 17,
              backgroundColor: activa ? cliente.chrome : "transparent",
              borderWidth: activa ? 0 : 1,
              borderColor: colores.borde,
            }}
          >
            <Text
              style={{
                color: activa ? "#f1f5f9" : colores.texto,
                fontSize: 13,
                fontWeight: activa ? "700" : "400",
              }}
            >
              {o.texto}
            </Text>
          </TouchableOpacity>
        );
      })}

      {/* El conteo a la derecha: sin él, un filtro que esconde 4.000 filas se ve igual
          que una lista vacía, y el recibidor no sabe si le falta un recibo o si es el
          filtro el que lo tapa. */}
      <Text style={{ marginLeft: "auto", color: colores.textoTenue, fontSize: 12 }}>
        {cuantas}
      </Text>
    </View>
  );
}

/**
 * La marca de que la fila YA SALIÓ del teléfono.
 *
 * Se lee de `syncStatus` de WatermelonDB: `synced` significa que el servidor la aceptó.
 * Importa mostrarlo porque es la condición para que los datos se puedan borrar del
 * teléfono, y porque un recibidor que ve "Enviado" sabe que su día ya está a salvo.
 *
 * ⚠️ Se muestra sólo cuando SÍ se envió. Un "pendiente" en cada fila del día sería ruido
 * constante: lo normal, durante toda la jornada, es que todavía no haya subido nada.
 */
export function MarcaEnviado({ enviado }: Readonly<{ enviado: boolean }>) {
  if (!enviado) return null;
  return (
    <Text style={{ color: colores.exito, fontSize: 11, fontWeight: "700" }}>ENVIADO</Text>
  );
}
