const { withAndroidManifest } = require("@expo/config-plugins");

/**
 * Fija la orientacion en horizontal PERO en los dos sentidos.
 *
 * `"orientation": "landscape"` de app.json escribe screenOrientation="landscape",
 * que amarra la tableta a UN solo lado: si el operario la agarra al reves, la
 * pantalla le queda de cabeza y no gira. En una tableta que se toma del carrito
 * sin mirar, eso pasa la mitad de las veces.
 *
 * "sensorLandscape" mantiene el bloqueo a horizontal —nunca se pone vertical,
 * que es lo que se quiere— y ademas deja que rote 180 grados.
 */
const orientacionHorizontal = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const principal = (app?.activity ?? []).find(
      (a) => a.$?.["android:name"] === ".MainActivity"
    );

    if (!principal) {
      throw new Error(
        "orientacion-horizontal: no se encontro .MainActivity en el manifest. " +
        "Cambio la plantilla de Expo; hay que revisar el plugin."
      );
    }

    principal.$["android:screenOrientation"] = "sensorLandscape";
    return cfg;
  });

module.exports = orientacionHorizontal;
