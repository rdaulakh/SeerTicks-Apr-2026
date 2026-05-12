import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "path";
import { defineConfig } from "vite";


const plugins = [react(), tailwindcss(), jsxLocPlugin()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Phase 90 — Vendor chunk splitting. Pre-fix: single 3.17 MB bundle.
    // Heavy libraries (recharts ~400KB, lightweight-charts ~200KB) split off
    // into their own chunks so they're browser-cached across page navigations.
    // App pages already get per-route chunks via React.lazy in App.tsx.
    chunkSizeWarningLimit: 1000, // raise from 500KB to 1MB
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-recharts': ['recharts'],
          'vendor-charts': ['lightweight-charts'],
          'vendor-react': ['react', 'react-dom', 'react/jsx-runtime'],
          'vendor-trpc': ['@trpc/client', '@trpc/react-query', '@tanstack/react-query'],
          'vendor-radix': [
            '@radix-ui/react-dialog',
            '@radix-ui/react-tabs',
            '@radix-ui/react-select',
            '@radix-ui/react-tooltip',
          ],
        },
      },
    },
  },
  server: {
    host: true,
    allowedHosts: [
      "localhost",
      "127.0.0.1",
    ],
    // Completely disable HMR to prevent WebSocket connection errors in proxy environment
    hmr: false,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    watch: {
      // Force chokidar to use polling to prevent EMFILE errors
      // This is critical for containerized/sandboxed environments
      usePolling: true,
      interval: 1000, // Check for changes every 1 second
      binaryInterval: 3000, // Check binary files every 3 seconds
      // Explicitly disable native watchers
      disableGlobbing: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/.next/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/tmp/**',
        '**/.cache/**',
        '**/server/**', // Don't watch server files (backend only)
        '**/drizzle/**', // Don't watch database files
        '**/scripts/**', // Don't watch scripts
      ],
    },
  },
});
