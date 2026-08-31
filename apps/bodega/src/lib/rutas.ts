import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { Partida } from "./bodegaApi";

/**
 * Las pantallas de la app y lo que recibe cada una.
 *
 * Vive acá y no en App.tsx para que las pantallas puedan tiparse contra esta
 * lista sin importar App.tsx —que a su vez las importa a ellas—.
 */
export type Rutas = {
  Login: undefined;
  Servidor: undefined;
  Bodega: undefined;
  Menu: undefined;
  Buscar: undefined;
  Mover: { partida: Partida };
};

export type Props<R extends keyof Rutas> = NativeStackScreenProps<Rutas, R>;
