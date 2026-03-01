import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve('src/shared'),
      '@main': path.resolve('src/main'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    rollupOptions: {
      external: ['node-pty', 'cloudflared', 'bufferutil', 'utf-8-validate'],
    },
  },
});
