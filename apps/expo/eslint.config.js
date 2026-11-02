const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const path = require('node:path');

module.exports = defineConfig([expoConfig, {
  ignores: ['dist/**', 'dist-native/**'],
  settings: {
    // Absolute paths containing parentheses are treated as globs by the resolver.
    'import/resolver': { typescript: { project: path.relative(process.cwd(), path.join(__dirname, 'tsconfig.json')) } },
  },
}]);
