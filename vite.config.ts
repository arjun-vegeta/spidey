import { defineConfig } from 'vite';

const BUILD_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    port: 3000,
    open: false,
    host: true,
    watch: {
      ignored: ['**/screenshots/**', '**/docs/**', '**/subagent_prompts/**', '**/scripts/**', '**/tests/**']
    }
  },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 1000
  }
});
