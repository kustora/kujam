import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts'],
      thresholds: {
        'packages/core/src/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/core/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'packages',
          include: ['packages/!(core)/src/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});

