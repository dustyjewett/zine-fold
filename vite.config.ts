import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs so the built site works from any sub-path on the NAS.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
