const fs = require("node:fs");
const path = require("node:path");
const clientes = require("./clientes.json");

/**
 * Config dinámica de Expo: toma app.json como base y le aplica el branding del
 * cliente que se esté compilando.
 *
 *   EXPO_PUBLIC_CLIENTE=altura npx expo prebuild --platform android --clean
 *   EXPO_PUBLIC_CLIENTE=altura npx expo run:android --variant release
 *
 * Sin la variable se usa el perfil `dev`, que reproduce exactamente los valores
 * que había antes en app.json. Eso NO es un detalle cosmético: el dev-client que
 * ya está instalado en el teléfono de prueba tiene el package
 * `cr.confeldan.recibos`, y si el default lo cambiara habría que reinstalarlo
 * en cada `expo start`.
 *
 * Por qué acá y no cinco app.json: el package de Android es lo que decide si dos
 * APK conviven o se pisan. Un beneficio que instale el de otro cliente encima
 * perdería su base local sin aviso. Derivarlo del mismo catálogo que el color y
 * la URL hace imposible que uno cambie y el otro no.
 */

const ID_DEFAULT = "dev";

function resolverCliente() {
  const id = process.env.EXPO_PUBLIC_CLIENTE ?? ID_DEFAULT;
  const cliente = clientes[id];
  if (!cliente || id.startsWith("_")) {
    const validos = Object.keys(clientes).filter((k) => !k.startsWith("_"));
    // Falla fuerte y temprano. Un typo en la variable no puede terminar en un APK
    // con el branding de otro cliente: eso se descubre cuando ya está instalado.
    throw new Error(
      `EXPO_PUBLIC_CLIENTE="${id}" no existe en clientes.json. Válidos: ${validos.join(", ")}`
    );
  }
  return { id, ...cliente };
}

/** Ruta a un asset del cliente, o undefined si el archivo todavía no está puesto. */
function assetSiExiste(nombreArchivo) {
  if (!nombreArchivo) return undefined;
  const rel = path.join("assets", "clientes", nombreArchivo);
  return fs.existsSync(path.join(__dirname, rel)) ? `./${rel.replace(/\\/g, "/")}` : undefined;
}

module.exports = ({ config }) => {
  const cliente = resolverCliente();

  // El ícono cuadrado lo genera scripts/iconos.js a partir del logo. Si todavía
  // no se corrió, se cae al ícono por defecto de Expo en vez de romper el build.
  const icono = assetSiExiste(`icono-${cliente.id}.png`);
  const logo = assetSiExiste(cliente.logo);

  return {
    ...config,
    name: cliente.nombre,
    ...(icono ? { icon: icono } : {}),
    splash: {
      ...config.splash,
      ...(icono ? { image: icono } : {}),
      backgroundColor: cliente.color,
    },
    android: {
      ...config.android,
      package: cliente.package,
      adaptiveIcon: {
        ...(icono ? { foregroundImage: icono } : {}),
        backgroundColor: cliente.color,
      },
    },
    extra: {
      ...config.extra,
      // La URL del catálogo gana sobre la de app.json. En runtime, el override
      // que el recibos guarde desde el drawer gana sobre ésta (ver lib/servidor.ts).
      apiBaseUrl: cliente.apiBaseUrl,
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        nombreLargo: cliente.nombreLargo,
        color: cliente.color,
        // Opcional: sin esto se deriva del color de marca. Sólo `dev` lo fija.
        // Se OMITE la clave en vez de mandarla en null: Expo serializa los null del
        // manifest como {}, que es truthy, y del otro lado terminaría usándose como
        // si fuera un color.
        ...(cliente.acento ? { acento: cliente.acento } : {}),
        tieneLogo: Boolean(logo),
        // El productor "PENDIENTE" de ESTE cliente. Se hornea en el APK porque hoy vive
        // en un .ini del legacy y varía por empresa. ⚠️ El servidor lo valida al recibir:
        // si el del APK y el suyo difieren, los recibos se atribuirían a otro productor
        // sin ningún error.
        idSocioGenerico: cliente.idSocioGenerico,
      },
    },
  };
};
