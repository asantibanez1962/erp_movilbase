// Metro config minimal para monorepo pnpm con node-linker=hoisted.
// Idéntico al de recibos-cr — ver ahí el detalle de por qué no hace falta
// disableHierarchicalLookup / unstable_enableSymlinks con linker hoisted.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Metro, en un monorepo, pone su "server root" en el ancestro comun del
// proyecto y los watchFolders — o sea en la raiz del monorepo. El plugin de
// gradle de React Native pasa --entry-file relativo al `root` del bloque react
// (apps/recibos), asi que los dos no coinciden y el bundle de release falla con
// "Unable to resolve module ./index.ts". Fijar la raiz de servidor al proyecto
// los pone de acuerdo.
config.server = { ...(config.server ?? {}), unstable_serverRoot: projectRoot };

module.exports = config;
