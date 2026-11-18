/**
 * Built-in benchmark: fix-failing-test.
 *
 * A small dependency-free JavaScript project with a genuine bug and a
 * failing node:test suite. The agent must fix the source so tests pass
 * WITHOUT modifying the tests (enforced by a file-hash acceptance check —
 * a deterministic anti-cheat criterion, not an LLM judgment).
 *
 * Files are materialized into each trial workspace from this template.
 */
import path from 'node:path';
import fs from 'node:fs';
import type { BenchmarkSpec } from './types.ts';
import { sha256 } from '../core/util.ts';

const TEST_FILE = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalPrice } from '../src/price.js';

test('no discount below threshold', () => {
  assert.equal(finalPrice(50, 0.1), 50);
});

test('discount applies at threshold', () => {
  assert.equal(finalPrice(100, 0.1), 90);
});

test('discount applies above threshold', () => {
  assert.equal(finalPrice(200, 0.25), 150);
});

test('zero discount is a no-op', () => {
  assert.equal(finalPrice(100, 0), 100);
});

test('just below threshold gets no discount', () => {
  assert.equal(finalPrice(99.99, 0.1), 99.99);
});

test('price rounds to cents', () => {
  assert.equal(finalPrice(200, 0.1234), 175.32);
});
`;

const SOURCE_FILE = `/**
 * Compute the final price after a discount.
 * Discount applies when the price is at least 100.
 */
export function finalPrice(price, discountRate) {
  // BUG: comparison is wrong — discount should apply at price >= 100.
  if (price > 100) {
    return Math.round(price * (1 - discountRate) * 100) / 100;
  }
  return price;
}
`;

const PACKAGE_JSON = JSON.stringify(
  {
    name: 'fix-failing-test-fixture',
    version: '1.0.0',
    private: true,
    type: 'module',
    scripts: { test: 'node --test test/' },
  },
  null,
  2,
);

const README = `# Pricing fixture

Run tests with: node --test test/
`;

export const BUILTIN_BENCHMARK_ID = 'fix-failing-test';

/** Materialize the built-in template into a directory (used at create time). */
export function materializeBuiltinTemplate(destDir: string): void {
  fs.mkdirSync(path.join(destDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(destDir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(destDir, 'package.json'), PACKAGE_JSON + '\n');
  fs.writeFileSync(path.join(destDir, 'README.md'), README);
  fs.writeFileSync(path.join(destDir, 'src', 'price.js'), SOURCE_FILE);
  fs.writeFileSync(path.join(destDir, 'test', 'price.test.js'), TEST_FILE);
}

export function builtinBenchmark(templateDir: string): BenchmarkSpec {
  return {
    schemaVersion: '1',
    id: BUILTIN_BENCHMARK_ID,
    title: 'Fix a failing test suite',
    description:
      'A pricing module has an off-by-one boundary bug: the discount must apply at price >= 100, but the code uses >. Five node:test cases cover the boundary; one fails initially. The agent must fix src/price.js without touching the tests.',
    source: { kind: 'template', path: templateDir },
    taskPrompt:
      'The test suite in test/price.test.js fails. Run the tests with `node --test test/`, diagnose the failure, and fix the bug in src/price.js so that ALL tests pass. Do NOT modify, delete, or weaken any test file. When done, run the tests again to verify.',
    acceptance: [
      {
        id: 'tests-pass',
        description: 'node --test test/ exits 0 (all tests pass)',
        kind: 'test-command',
        command: 'node --test test/',
        timeoutMs: 60_000,
      },
      {
        id: 'tests-unchanged',
        description: 'Test file is byte-identical to the original (anti-cheat)',
        kind: 'file-hash',
        path: 'test/price.test.js',
        sha256: sha256(TEST_FILE),
      },
      {
        id: 'source-exists',
        description: 'src/price.js still exists',
        kind: 'file-exists',
        path: 'src/price.js',
      },
    ],
    limits: { timeoutMs: 300_000 },
  };
}

/** Resolve the built-in template directory under Caliper state (created on demand). */
export function builtinTemplateDir(caliperHomeDir: string): string {
  const dir = path.join(caliperHomeDir, 'benchmarks', BUILTIN_BENCHMARK_ID, 'template');
  if (!fs.existsSync(path.join(dir, 'test', 'price.test.js'))) {
    materializeBuiltinTemplate(dir);
  }
  return dir;
}
