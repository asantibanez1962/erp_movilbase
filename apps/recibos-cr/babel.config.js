// Babel config:
//   - babel-preset-expo: default RN/Expo
//   - @babel/plugin-proposal-decorators legacy: WMDB models usan decorators
//     (@field, @relation). DEBE ir al principio para que corra antes que
//     cualquier otro plugin que transforme classes.
//   - react-native-worklets/plugin: requerido por react-native-reanimated v4
//     (que a su vez requiere @react-navigation/drawer + bottom-tabs animations).
//     DEBE ir AL FINAL — el plugin transforma "worklet" functions y necesita
//     ver el code ya transformado por todo lo demás.

module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["@babel/plugin-proposal-decorators", { legacy: true }],
      "react-native-worklets/plugin",
    ],
  };
};
