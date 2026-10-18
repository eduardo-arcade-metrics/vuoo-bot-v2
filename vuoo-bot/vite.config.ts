import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/* the VUOO Bot page: its own app, using the engine in ../src and the spec in ../docs.
   Served from /vuoo-bot-v2/ on GitHub Pages. */
export default defineConfig({
  root: __dirname,
  base: '/vuoo-bot-v2/',
  plugins: [react()],
  server: { fs: { allow: [resolve(__dirname, '..')] } },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true },
});
