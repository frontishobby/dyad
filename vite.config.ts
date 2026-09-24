import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/** The service worker's cache name carries this, so every deploy replaces the shell cache. */
function buildId(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return String(Date.now());
  }
}

/** public/sw.js is copied verbatim; stamp the build id into the copy in dist/. */
function stampServiceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'dyad-stamp-sw',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const path = join(outDir, 'sw.js');
      const text = readFileSync(path, 'utf8');
      writeFileSync(path, text.replace('__DYAD_BUILD__', buildId()));
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), stampServiceWorker()],
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
