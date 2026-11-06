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

module.exports = config;
