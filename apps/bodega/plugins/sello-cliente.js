const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod } = require("@expo/config-plugins");

/**
 * Deja escrito en android/ para QUE CLIENTE se prebuildeo.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * app.config.js se evalua DOS veces con el mismo codigo pero en momentos
 * distintos:
 *
 *   1. `expo prebuild`  → decide package, nombre, icono y splash (lo NATIVO)
 *   2. `gradlew assembleRelease` → adentro corre `expo export:embed`, que
 *      vuelve a evaluarlo para armar el manifest que va en el bundle (lo que
 *      la app lee en runtime: apiBaseUrl, color, logo)
 *
 * Son dos procesos separados. Si EXPO_PUBLIC_CLIENTE esta seteada en el
 * primero pero no en el segundo —dos comandos en shells distintos, que es lo
 * normal— el APK sale a mitad de camino: el package y el nombre del launcher
 * son del cliente, pero la URL, el color y el logo son del perfil `dev`.
 *
 * Y NO FALLA. El APK compila, se instala, arranca y muestra el nombre correcto
 * en el launcher. El sintoma aparece recien cuando alguien intenta entrar y le
 * da error de red, con una IP que no es la de su beneficio. Ya paso: el APK de
 * demo salio con `10.0.2.2:5249` adentro.
 *
 * LA SOLUCION
 * -----------
 * Este plugin estampa el id en android/ durante el prebuild. app.config.js lo
 * lee: si la variable no viene, USA EL SELLO en vez de caer a `dev`; si viene
 * y no coincide, revienta. Asi la segunda evaluacion no puede discrepar de la
 * primera, con o sin variable de ambiente.
 *
 * El archivo vive dentro de android/, que esta gitignoreada y que
 * `prebuild --clean` borra entera: el sello no puede quedar viejo apuntando a
 * un cliente que ya no es el prebuildeado.
 */

const ARCHIVO_SELLO = ".cliente-compilado";

const selloCliente = (config, { id }) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      // DENTRO de android/, no en la raiz de la app: asi `prebuild --clean`
      // —que borra android/ entera— se lleva el sello con ella. Un sello que
      // sobrevive al clean miente sobre que hay prebuildeado, que es peor que
      // no tenerlo. Y de paso queda gitignoreado como el resto de android/.
      const destino = path.join(cfg.modRequest.platformProjectRoot, ARCHIVO_SELLO);
      fs.writeFileSync(destino, `${id}\n`, "utf8");
      return cfg;
    },
  ]);

module.exports = selloCliente;
module.exports.ARCHIVO_SELLO = ARCHIVO_SELLO;
