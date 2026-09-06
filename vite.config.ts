import { defineConfig } from 'vite';

const BUILD_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 3000,
    open: false,
    host: true
  },
  build: {
    target: 'esnext'
  }
});
