import { defineConfig } from 'vitest/config'

// Tests against a real PostgreSQL (npm run test:db). They create and remove their own <DATABASE_NAME>_test database.
export default defineConfig({
    resolve: { tsconfigPaths: true },
    test: {
        globals: true,
        root: './',
        include: ['**/*.db-spec.ts'],
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000
    }
})
