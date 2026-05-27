// Metro config para monorepo pnpm. Sin esto, Metro busca módulos solo en
// node_modules del app y falla al resolver @erp/shared-* (que viven en
// ../../packages/* via symlinks de pnpm).
//
// Config requerido:
//   - watchFolders: paths a vigilar para hot-reload + resolución.
//   - nodeModulesPaths: dónde buscar deps (app + workspace root).
//   - disableHierarchicalLookup: pnpm symlinks confunden el lookup default.
//   - unstable_enableSymlinks: Metro debe SEGUIR los symlinks que crea pnpm.
//   - unstable_enablePackageExports: respeta el "exports" field de package.json,
//     necesario para algunos paquetes Expo modernos.

const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
