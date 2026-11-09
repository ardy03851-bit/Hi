import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs work on both username.github.io and project Pages paths.
  base: './',
  build: {
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
});
