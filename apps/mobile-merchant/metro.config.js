// Metro — bundler React Native. Vite TIDAK dipakai di sisi mobile.
// Konfigurasi monorepo: Metro harus diberi tahu bahwa dependensi
// berada di root workspace, bukan hanya di folder app ini.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Pantau seluruh workspace agar perubahan di packages/* memicu reload
config.watchFolders = [workspaceRoot];

// Cari node_modules di app ini lalu di root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// pnpm memakai symlink secara agresif — keduanya wajib
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
