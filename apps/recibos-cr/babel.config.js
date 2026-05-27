// Babel config para WatermelonDB:
//   - babel-preset-expo: default RN/Expo
//   - @babel/plugin-proposal-decorators legacy: WMDB models declaran fields
//     y relationes con decorators (@field, @relation, etc.) y todavía no
//     se actualizaron al spec stage-3. legacy=true es lo que su docs piden.
//
// El plugin de decorators DEBE ir antes que cualquier otro plugin que
// transforme classes — por eso al principio del array.

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      ["@babel/plugin-proposal-decorators", { legacy: true }],
    ],
  };
};
