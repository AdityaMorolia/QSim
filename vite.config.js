import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { rollupOptions: { input: { builder: 'index.html', display: 'display.html' } } },
});
