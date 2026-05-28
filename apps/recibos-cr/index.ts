// Gesture handler debe importarse PRIMERO, antes que cualquier otra cosa
// (incluido el App). Sin esto, los gestos del Drawer / Tabs no funcionan
// y la app crashea en RN 0.81+ con error de turbo modules.
import "react-native-gesture-handler";

import { registerRootComponent } from "expo";
import App from "./App";

registerRootComponent(App);
