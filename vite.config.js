// vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  build: { outDir: 'dist' },

  optimizeDeps: {
    // do not pre-bundle these (they cause export-shape issues)
    exclude: [
      '@tracespace/parser',
      '@tracespace/plotter',
      'nearley',
      'moo'
    ]
  },

  // When packaging/electron dev, avoid forcing externalization incorrectly
  ssr: {
    noExternal: ['@tracespace/parser', '@tracespace/plotter', 'nearley', 'moo']
  },

  // make sure top-level-await is accepted in dev if used
  esbuild: { supported: { 'top-level-await': true } }
});
