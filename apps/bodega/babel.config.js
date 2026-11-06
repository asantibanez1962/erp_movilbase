// Babel config: solo babel-preset-expo.
//
// Las otras apps del monorepo suman dos plugins que ACA NO VAN, y que se
// colaron al copiar el andamiaje:
//
//   - @babel/plugin-proposal-decorators — lo piden los modelos de WatermelonDB
//     (@field, @relation). Esta app no tiene base local, asi que no hay
//     modelos que decorar.
//   - react-native-worklets/plugin — lo pide reanimated v4, que a su vez lo
//     piden el Drawer y los bottom-tabs. Aca la navegacion es un native-stack
//     pelado.
//
// Ninguno de los dos esta en las dependencias de esta app: dejarlos en la
// lista hace que Babel los busque, los encuentre por hoisting del workspace
// —o no los encuentre— segun como quede node_modules ese dia. Un bundle que
// compila o no segun el linker es peor que uno que no compila nunca.

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
