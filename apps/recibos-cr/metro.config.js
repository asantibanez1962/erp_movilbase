// Metro config minimal para monorepo pnpm con node-linker=hoisted.
// Con linker hoisted la estructura de node_modules es flat (estilo npm),
// así que solo necesitamos avisarle a Metro de los paths del workspace
// para que watch + resolución funcionen.
//
// Sin los workarounds que necesitaba pnpm nested (disableHierarchicalLookup,
// unstable_enableSymlinks) — expo-doctor se queja si están seteados sin
// necesidad real.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Append (no override) los watchFolders default para que Metro vea cambios
// en packages/* además de los suyos propios.
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

// Buscar deps también en el node_modules del root del workspace.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

module.exports = config;
