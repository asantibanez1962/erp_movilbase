const fs = require("node:fs");
const path = require("node:path");
const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Plugin de firma: hace que el APK de release se firme con el keystore de
 * Confeldan en vez de con la llave de depuracion.
 *
 * POR QUE UN PLUGIN Y NO EDITAR build.gradle
 * ------------------------------------------
 * `expo prebuild --clean` BORRA y regenera android/ completo. Cualquier cambio
 * hecho a mano en android/app/build.gradle se pierde en el siguiente prebuild
 * —y hay que prebuildear cada vez que se compila otro cliente, porque el
 * package sale de clientes.json—. Un plugin se vuelve a aplicar solo en cada
 * regeneracion: es la unica forma de que la firma no dependa de que alguien se
 * acuerde de reponerla.
 *
 * POR QUE IMPORTA LA FIRMA
 * ------------------------
 * Android identifica una app por su package MAS la llave con que se firmo. Un
 * APK firmado con la llave de depuracion no se puede actualizar despues con uno
 * firmado de verdad: hay que desinstalar, y desinstalar borra la base local del
 * telefono junto con lo que el promotor no haya sincronizado.
 *
 * SI FALTA EL ARCHIVO DE CREDENCIALES
 * -----------------------------------
 * No rompe el prebuild: deja la firma de depuracion y avisa por consola. Asi un
 * desarrollador que clona el repo puede trabajar sin tener el keystore, que no
 * se versiona. Pero para un APK que va a un telefono de campo, el aviso hay que
 * atenderlo.
 */

const ARCHIVO_CREDENCIALES = "android-keystore.properties";

function leerCredenciales(raizProyecto) {
  const ruta = path.join(raizProyecto, ARCHIVO_CREDENCIALES);
  if (!fs.existsSync(ruta)) return null;

  const datos = {};
  for (const linea of fs.readFileSync(ruta, "utf8").split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte < 0) continue;
    datos[limpia.slice(0, corte).trim()] = limpia.slice(corte + 1).trim();
  }

  const faltan = ["storeFile", "storePassword", "keyAlias", "keyPassword"]
    .filter((k) => !datos[k]);
  if (faltan.length > 0) {
    throw new Error(
      `${ARCHIVO_CREDENCIALES} existe pero le faltan claves: ${faltan.join(", ")}`
    );
  }
  if (!fs.existsSync(datos.storeFile)) {
    throw new Error(
      `El keystore no esta donde dice ${ARCHIVO_CREDENCIALES}: ${datos.storeFile}`
    );
  }
  return datos;
}

const firmaRelease = (config) =>
  withAppBuildGradle(config, (cfg) => {
    const cred = leerCredenciales(cfg.modRequest.projectRoot);

    // En EAS la firma NO sale de aca. El .jks no se versiona, asi que en la nube
    // este plugin nunca encuentra credenciales; quien firma es el sistema de
    // credenciales de EAS, con el keystore que se le haya subido.
    //
    // Se distingue del caso local a proposito. Con el aviso generico, un build de
    // EAS imprimiria "se va a firmar con la llave de DEPURACION" —que ahi es
    // ENGANOSO, porque EAS todavia va a firmarlo bien— y a la vez ese mismo texto
    // es el unico sintoma cuando de verdad falta el keystore. Un aviso que grita
    // en el caso bueno deja de leerse en el malo.
    if (process.env.EAS_BUILD === "true") {
      console.log("");
      console.log("  [firma] Build de EAS: firma con las credenciales de EAS.");
      console.log("  VERIFICAR la huella antes de repartir el APK:");
      console.log("    apksigner verify --print-certs <apk>");
      console.log("  Debe decir SHA-256: 75bd2b75218dd14603653fb6b39a414106dfa41c9e82f0796db2a0386abed9c6");
      console.log("");
      return cfg;
    }

    if (!cred) {
      console.warn(
        `\n  AVISO: no se encontro ${ARCHIVO_CREDENCIALES}.` +
        `\n  El APK de release se va a firmar con la llave de DEPURACION.` +
        `\n  Sirve para probar; NO para un telefono de trabajo.\n`
      );
      return cfg;
    }

    let gradle = cfg.modResults.contents;

    // Gradle usa / como separador en cualquier plataforma.
    const rutaJks = cred.storeFile.replace(/\\/g, "/");

    const bloque =
      `        release {\n` +
      `            storeFile file('${rutaJks}')\n` +
      `            storePassword '${cred.storePassword}'\n` +
      `            keyAlias '${cred.keyAlias}'\n` +
      `            keyPassword '${cred.keyPassword}'\n` +
      `        }\n`;

    // 1. Sumar el signingConfig 'release' junto al 'debug' que ya genera Expo.
    //
    // La guarda es la RUTA DEL KEYSTORE, no la presencia de un `release {`. Con
    // un patron tipo /signingConfigs\s*\{[\s\S]*?release\s*\{/ el comodin cruza
    // TODO el archivo y engancha el `release {` de buildTypes, que siempre
    // existe: la guarda concluye "ya esta puesto" y no inserta nada. Paso, y el
    // resultado fue un buildType apuntando a una signingConfig inexistente.
    if (!gradle.includes(rutaJks)) {
      gradle = gradle.replace(/(signingConfigs\s*\{\n)/, `$1${bloque}`);
    }

    // 2. Que el buildType release lo use. Expo lo deja apuntando a debug.
    gradle = gradle.replace(
      /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?signingConfig\s+)signingConfigs\.debug/,
      "$1signingConfigs.release"
    );

    // Verificacion: si alguno de los dos reemplazos no pego, el APK saldria con
    // firma de depuracion y NADIE se enteraria hasta que sea tarde. Preferimos
    // romper el prebuild.
    // Se comprueban LAS DOS MITADES por separado. Verificar solo que exista el
    // texto "signingConfigs.release" no alcanza: lo escribe el reemplazo de
    // arriba, asi que la comprobacion pasa aunque el bloque con las credenciales
    // nunca se haya insertado. Eso ya paso una vez, y el APK habria salido con
    // una referencia a una signingConfig que no existe.
    const tieneBloque = gradle.includes(rutaJks);
    const apunta = /buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?signingConfig\s+signingConfigs\.release/
      .test(gradle);

    if (!tieneBloque || !apunta) {
      throw new Error(
        "firma-release: la firma no quedo aplicada" +
        (tieneBloque ? "" : " [falta el bloque signingConfigs.release con el keystore]") +
        (apunta ? "" : " [el buildType release no lo usa]") +
        ". Cambio la plantilla de build.gradle de Expo; hay que revisar el plugin."
      );
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });

module.exports = firmaRelease;
