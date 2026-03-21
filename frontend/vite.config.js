import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        nodePolyfills({
            include: ['buffer', 'process', 'util', 'stream', 'events'],
            globals: { Buffer: true, process: true },
        }),
    ],
    server: {
        port: 5173,
        proxy: {
            '/api': 'http://localhost:3001',
            '/doodles': 'http://localhost:3001',
        },
    },
    optimizeDeps: {
        esbuildOptions: {
            define: { global: 'globalThis' },
        },
    },
});
