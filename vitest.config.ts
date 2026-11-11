import { defineConfig } from 'vitest/config'

// Las horas de las pruebas son las de CDMX: se fija aquí para que no dependan de la zona de quien las corre.
process.env.TZ = 'America/Mexico_City'

export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: { environment: 'jsdom', clearMocks: true, setupFiles: ['./src/test-setup.ts'] },
})
