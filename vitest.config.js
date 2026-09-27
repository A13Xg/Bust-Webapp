import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
// supabase/functions/_shared/*.test.ts are Deno tests (npm run test:functions),
// not Vitest's — without this exclude, Vitest's default glob picks them up
// too and fails trying to run Deno.test/jsr: imports under Node.
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, exclude: [...configDefaults.exclude, 'supabase/**'] },
});
