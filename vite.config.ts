import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        planritaren: resolve(__dirname, 'index.html'),
        byggplaneraren: resolve(__dirname, 'byggprojekt.html'),
      },
    },
  },
  test: {
    environment: 'node',
  },
});
