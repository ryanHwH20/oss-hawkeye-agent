import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The source uses NodeNext-style `.js` import specifiers that point at `.ts`
  // files. Rewrite those back to extensionless so Vite can resolve them.
  resolve: {
    alias: [{ find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
