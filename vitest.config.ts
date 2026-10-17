import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.test-d.ts', '**/*.spec.ts'],
      thresholds: {
        'packages/core/src/**/*.ts': {
          lines: 90,
          functions: 90,
          branches: 85,
          statements: 90,
        },
        // BOARD-403: the geometry library must stay fully covered.
        'packages/core/src/geometry.ts': {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
      },
    },
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/core/src/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'packages',
          include: ['packages/!(core)/src/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      {
        // BOARD-102/106/107: proof that build and lint rules work against violation fixtures.
        test: {
          name: 'tooling',
          include: ['tooling/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
    ],
  },
});
