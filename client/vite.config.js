import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the large, rarely-changing dependencies out of the app chunk. They are
        // then cached independently of application code, so a deploy that touches only
        // our own source does not force everyone to re-download the editor stack.
        // Rolldown (Vite 8) takes the function form, not an object map.
        //
        // Only React is grouped here. Naming a chunk makes it a static dependency of
        // whatever references it, so grouping the editor stack this way pulled it back
        // into the entry's modulepreload list and undid the lazy import in
        // RequestTabs.jsx. Left alone, the dynamic import boundary splits it correctly.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          const path = id.replace(/\\/g, '/');
          if (/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    // Default to node: most tests here cover pure logic, and booting jsdom for those
    // costs more than the tests themselves. Component tests opt in per file with a
    // `// @vitest-environment jsdom` docblock.
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['./src/test-setup.js'],
  },
})
