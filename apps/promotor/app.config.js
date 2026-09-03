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
 * `cr.confeldan.promotor`, y si el default lo cambiara habría que reinstalarlo
 * en cada `expo start`.
 *
 * Por qué acá y no cinco app.json: el package de Android es lo que decide si dos
 * APK conviven o se pisan. Un beneficio que instale el de otro cliente encima
 * perdería su base local sin aviso. Derivarlo del mismo catálogo que el color y
 * la URL hace imposible que uno cambie y el otro no.
 */

const ID_DEFAULT = "dev";
const ARCHIVO_SELLO = ".cliente-compilado";

/**
 * El cliente que dejo estampado el ultimo prebuild, o null si no hay android/.
 *
 * Existe porque este archivo se evalua DOS veces —una en `expo prebuild`, otra
 * dentro de gradle cuando `expo export:embed` arma el bundle— y son procesos
 * separados. Sin el sello, una variable de ambiente puesta solo en el primero
 * deja un APK con el package de un cliente y la URL de otro, que compila,
 * instala y arranca sin quejarse.
 *
 * NO ES HIPOTETICO: el APK de Promotor Altura del 30-ago-2026 salio asi —
 * package cr.confeldan.promotor.altura y adentro el perfil `dev` con
 * 10.0.2.2:5249, que solo existe en un emulador. Ver plugins/sello-cliente.js.
 */
function leerSello() {
  try {
    const ruta = path.join(__dirname, "android", ARCHIVO_SELLO);
    if (!fs.existsSync(ruta)) return null;
    const id = fs.readFileSync(ruta, "utf8").trim();
    return id || null;
  } catch {
    return null;
  }
}

/**
 * ¿El comando en curso es un `expo prebuild`?
 *
 * Se mira argv y no una variable propia porque la respuesta tiene que ser un
 * hecho del proceso, no algo que alguien pueda dejar exportado en su shell sin
 * darse cuenta — que es exactamente la clase de error que este archivo existe
 * para atajar.
 *
 * La comparacion es EXACTA contra "prebuild" y no un `includes` sobre la linea
 * entera: la segunda evaluacion la dispara `expo export:embed` dentro de gradle,
 * y una coincidencia floja ahi seria un falso positivo que apaga el guard justo
 * en el momento en que hace falta. Si esto se equivoca, que se equivoque
 * bloqueando.
 */
function esPrebuild() {
  return process.argv.some((a) => a === "prebuild");
}

function resolverCliente() {
  const sello = leerSello();
  const pedido = process.env.EXPO_PUBLIC_CLIENTE ?? null;

  // Sin variable, MANDA EL SELLO: la segunda evaluacion hereda lo que decidio
  // el prebuild aunque nadie exporte nada. Sin sello vale el default.
  const id = pedido ?? sello ?? ID_DEFAULT;

  // Con variable Y sello que no coinciden no hay forma de adivinar cual gana
  // sin producir un APK mezclado. Se rompe fuerte.
  //
  // SALVO durante un prebuild, que es precisamente la operacion que REESCRIBE el
  // sello: ahi el desacuerdo no es un peligro sino el pedido de cambiar de
  // cliente. Sin esta salida el guard se muerde la cola —el remedio que sugeria
  // el mensaje (`prebuild --clean`) evalua la config ANTES de borrar android/, o
  // sea que chocaba contra el propio guard y no habia forma de cambiar de cliente
  // sin borrar el sello a mano. Comprobado el 03-sep-2026.
  if (pedido && sello && pedido !== sello) {
    if (!esPrebuild()) {
      throw new Error(
        `android/ esta prebuildeado para "${sello}" pero se esta compilando como "${pedido}".\n` +
        `El APK saldria con el package de uno y la URL y el logo del otro.\n` +
        `Corre de nuevo:  EXPO_PUBLIC_CLIENTE=${pedido} npx expo prebuild --platform android --clean`
      );
    }
    // Se avisa igual: el prebuild se va a llevar puesto lo nativo del cliente
    // anterior, y conviene que quede dicho en la consola y no solo en el diff.
    console.warn(
      `[sello] android/ estaba prebuildeado para "${sello}" y se va a regenerar como "${pedido}".`
    );
  }

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
    // El sello se registra ACA y no en app.json porque necesita el id ya
    // resuelto, que app.json no puede saber.
    plugins: [...(config.plugins ?? []), ["./plugins/sello-cliente", { id: cliente.id }]],
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
      // que el promotor guarde desde el drawer gana sobre ésta (ver lib/servidor.ts).
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
      },
    },
  };
};
