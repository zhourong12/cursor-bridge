import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { cli: 'src/cli/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    clean: true,
    sourcemap: false,
    splitting: false,
    dts: false,
  },
  {
    entry: { 'admin-boot': 'src/admin/boot.ts' },
    outDir: 'dist',
    format: ['cjs'],
    outExtension: () => ({ js: '.cjs' }),
    target: 'node20',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    dts: false,
    noExternal: [/^[^./]/],
    external: ['@larksuiteoapi/node-sdk', 'qrcode'],
    esbuildOptions(options) {
      options.banner = {
        js: 'var __import_meta_url=require("url").pathToFileURL(__filename).href;',
      };
      options.define = {
        ...options.define,
        'import.meta.url': '__import_meta_url',
      };
    },
  },
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    sourcemap: false,
    splitting: false,
    dts: true,
  },
]);
