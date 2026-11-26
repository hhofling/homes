import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        planritaren: resolve(__dirname, 'index.html'),
        byggplaneraren: resolve(__dirname, 'byggprojekt.html'),
        tomtplaneraren: resolve(__dirname, 'tomt.html'),
        hemprojekt: resolve(__dirname, 'hem.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
