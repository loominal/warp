import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        'vitest.config.ts',
        'eslint.config.js',
        '*.mjs', // Test scripts
        'src/index.ts', // Entry point, hard to test in isolation
        'src/tools/index.ts', // Re-export file
        'src/tools/channels.ts', // Utility, tested via integration
        'src/tools/messaging.ts', // Utility, tested via integration
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
