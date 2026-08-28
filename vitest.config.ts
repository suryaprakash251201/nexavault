import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      obsidian: resolve(__dirname, 'src/__tests__/obsidian-stub.ts'),
    },
  },
});
