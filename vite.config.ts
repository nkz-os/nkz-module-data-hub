import { defineConfig } from 'vite';
import { nkzModulePreset } from '@nekazari/module-builder';
import path from 'path';

export default defineConfig(
  nkzModulePreset({
    // Until @nekazari/module-builder publishes a version that adds
    // @tanstack/react-query to NKZ_SHARED, declare it here so the federation
    // runtime shares the singleton with the host (host's NKZProvider mounts
    // <QueryClientProvider> and DataTree's useQuery must read the same context).
    additionalShared: {
      '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
    },
    viteConfig: {
      resolve: {
        alias: { '@': path.resolve(__dirname, './src') },
      },
      server: {
        port: 5004,
        proxy: {
          // Use VITE_PROXY_TARGET for local dev (e.g. https://your-api-domain). No default to avoid hardcoded URLs.
          '/api': {
            target: process.env.VITE_PROXY_TARGET || 'http://localhost:8000',
            changeOrigin: true,
            secure: process.env.VITE_PROXY_TARGET?.startsWith('https') ?? false,
          },
        },
      },
    },
  }),
);
