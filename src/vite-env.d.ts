/// <reference types="vite/client" />

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Baked at server start (vite.config define). Identifies which build is running.
declare const __BUILD_ID__: string;
