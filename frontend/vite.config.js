import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const hmrHost = env.VITE_HMR_HOST || undefined;
  const hmrProtocol = env.VITE_HMR_PROTOCOL || undefined; // ws | wss
  const hmrPort = env.VITE_HMR_PORT ? Number(env.VITE_HMR_PORT) : undefined;
  const hmrClientPort = env.VITE_HMR_CLIENT_PORT ? Number(env.VITE_HMR_CLIENT_PORT) : undefined;
  const backendUrl = env.VITE_BACKEND_URL || 'http://localhost:3001';

  const hmr = (hmrHost || hmrProtocol || hmrPort || hmrClientPort)
    ? { host: hmrHost, protocol: hmrProtocol, port: hmrPort, clientPort: hmrClientPort }
    : true;

  return {
    // Ensure multi-page build output so /chat works in production
    build: {
      rollupOptions: {
        input: {
          main: resolve(process.cwd(), 'index.html'),
          chat: resolve(process.cwd(), 'chat/index.html'),
        }
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      hmr,
      // Allow running without the node proxy by forwarding /api -> backend
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        }
      }
    }
  };
});
