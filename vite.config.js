import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy third-party deps into long-cached vendor chunks so the
        // initial app bundle stays small and these only download once.
        // NOTE: this build uses Rolldown, whose manualChunks must be a function
        // (the Rollup object form throws "Expected Function but received Object").
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          const after = id.split('node_modules/').pop()
          const pkg = after.startsWith('@')
            ? after.split('/').slice(0, 2).join('/')
            : after.split('/')[0]
          if (['react', 'react-dom', 'react-router-dom', 'react-router', 'scheduler'].includes(pkg)) return 'vendor-react'
          if (pkg.startsWith('@supabase')) return 'vendor-supabase'
          if (pkg === 'lucide-react') return 'vendor-ui'
          // Keep recharts and its d3 dependency tree together off the main bundle.
          if (pkg === 'recharts' || pkg === 'victory-vendor' || pkg.startsWith('d3-') || pkg === 'd3-shape') return 'vendor-charts'
        },
      },
    },
  },
})
