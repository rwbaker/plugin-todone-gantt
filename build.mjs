import * as esbuild from 'esbuild';

// Worker + manifest bundles (Node)
await esbuild.build({
  entryPoints: ['src/worker.ts', 'src/manifest.ts', 'src/todone-client.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  sourcemap: true,
  external: ['@paperclipai/plugin-sdk', '@paperclipai/plugin-sdk/*'],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});

// UI bundle (browser)
await esbuild.build({
  entryPoints: ['src/ui/index.tsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'esm',
  outdir: 'dist/ui',
  external: ['react', 'react/jsx-runtime', '@paperclipai/plugin-sdk/ui'],
  jsx: 'automatic',
});

console.log('Build complete.');
