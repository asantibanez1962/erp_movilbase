const path = require("node:path");
const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Plugin de monorepo: apunta `react { root }` a la raiz del workspace.
 *
 * EL PROBLEMA
 * -----------
 * Al compilar el APK, Gradle invoca a Expo asi:
 *
 *     expo export:embed --entry-file index.ts ...
 *
 * El plugin de Gradle de React Native toma el `entryFile` —que Expo resuelve
 * bien, a la ruta absoluta apps/promotor/index.ts— y lo RELATIVIZA contra
 * `root`, que por defecto es la carpeta de la app. Queda "index.ts".
 *
 * Del otro lado, Metro en un monorepo pone su raiz de servidor en la raiz del
 * WORKSPACE, porque metro.config.js suma el workspace a watchFolders (hace
 * falta: los paquetes compartidos viven ahi). Entonces resuelve "index.ts"
 * contra E:\soft\mobile-erp y no lo encuentra:
 *
 *     Unable to resolve module ./index.ts from E:\soft\mobile-erp/.
 *
 * El bundling a mano con --entry-file absoluto funciona; lo que falla es el
 * paso intermedio.
 *
 * LA SOLUCION
 * -----------
 * Poner `root` en la raiz del workspace. El plugin de Gradle relativiza contra
 * ella y pasa "apps/promotor/index.ts", que es exactamente lo que Metro espera.
 *
 * POR QUE UN PLUGIN
 * -----------------
 * `expo prebuild --clean` regenera android/ entero y hay que prebuildear por
 * cada cliente, asi que editar build.gradle a mano no dura nada.
 */

const monorepoEntry = (config) =>
  withAppBuildGradle(config, (cfg) => {
    const raizApp = cfg.modRequest.projectRoot;              // apps/promotor
    const raizWorkspace = path.resolve(raizApp, "../..");     // raiz del monorepo

    // Desde android/app —donde vive build.gradle— hasta la raiz del workspace.
    const relativo = path
      .relative(path.join(raizApp, "android", "app"), raizWorkspace)
      .replace(/\\/g, "/");

    let gradle = cfg.modResults.contents;

    if (gradle.includes("/* ERP: root de monorepo */")) return cfg;

    // Expo deja un comentario "/* Folders */" como marcador dentro de react {}.
    const marcador = "    /* Folders */";
    if (!gradle.includes(marcador)) {
      throw new Error(
        "monorepo-entry: no aparece el marcador '/* Folders */' en el bloque " +
        "react {}. Cambio la plantilla de Expo; hay que revisar el plugin."
      );
    }

    gradle = gradle.replace(
      marcador,
      `    /* ERP: root de monorepo */\n` +
      `    root = file("${relativo}")\n` +
      marcador
    );

    if (!/^\s*root = file\(/m.test(gradle)) {
      throw new Error("monorepo-entry: no se pudo fijar react.root.");
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });

module.exports = monorepoEntry;
