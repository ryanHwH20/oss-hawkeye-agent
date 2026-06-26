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
    // Make exponential backoff instant so retry paths don't slow the suite,
    // and keep the cross-process disk cache out of the network-stubbing tests
    // so cached payloads never leak between cases (disk-cache.test.ts opts in).
    env: { HAWKEYE_RETRY_BASE_MS: '0', HAWKEYE_NO_CACHE: '1' },
  },
});
