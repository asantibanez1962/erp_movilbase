// Gesture handler debe importarse PRIMERO, antes que cualquier otra cosa
// (incluido el App). Lo pide react-native-screens para los gestos del
// native-stack; sin esto la app crashea en RN 0.81+ con error de turbo
// modules.
import "react-native-gesture-handler";

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
