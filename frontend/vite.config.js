import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Wymagane, by Vite działał prawidłowo w Dockerze
    port: 5173,
    allowedHosts: [
      'compliance.aufy.pl'
    ],
    // Konfiguracja HMR (WebSocket dla odświeżania na żywo)
    hmr: {
      host: 'compliance.aufy.pl',
      clientPort: 443, // Ponieważ masz z zewnątrz HTTPS (wss://), wymuszamy port 443 dla klienta
      protocol: 'wss'
    },
    // Wymuszenie odpytywania plików w Dockerze (szczególnie Windows/Mac)
    watch: {
      usePolling: true
    }
  }
})