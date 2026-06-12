module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { nativewind: { env: 'native' } }]],
    plugins: ['react-native-reanimated/plugin'],
  };
};
