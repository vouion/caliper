/**
 * Benchmark loading, fingerprinting, and workspace isolation.
 *
 * Isolation contract: every trial runs in a FRESH workspace materialized
 * from the benchmark source. The user's real repositories are never touched.
 * Template sources are copied; git sources are cloned locally with
 * --no-hardlinks (no network, no shared object store).
 */
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { BenchmarkSpec } from './types.ts';
import { HavrinError, errorMessage } from '../core/errors.ts';
import { sha256 } from '../core/util.ts';
import { isDirectory } from '../core/fs.ts';
import { validateBenchmark } from './validate.ts';
import { builtinBenchmark, builtinTemplateDir, BUILTIN_BENCHMARK_ID } from './builtin.ts';

const MAX_TEMPLATE_FILES = 5000;
const MAX_TEMPLATE_BYTES = 64 * 1024 * 1024;

/** Load a benchmark from a JSON file, or resolve the built-in by id. */
export function loadBenchmark(ref: string, havrinHomeDir: string): BenchmarkSpec {
  if (ref === `builtin:${BUILTIN_BENCHMARK_ID}` || ref === BUILTIN_BENCHMARK_ID) {
    const templateDir = builtinTemplateDir(havrinHomeDir);
    return builtinBenchmark(templateDir);
  }
  if (ref.startsWith('builtin:')) {
    throw new HavrinError('USAGE', `Unknown built-in benchmark: ${ref}`, `Available built-ins: ${BUILTIN_BENCHMARK_ID}`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(ref, 'utf8');
  } catch (err) {
    throw new HavrinError('IO', `Cannot read benchmark file ${ref}: ${errorMessage(err)}`, 'Use a JSON file path or builtin:fix-failing-test.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HavrinError('PARSE', `Benchmark file ${ref} is not valid JSON`);
  }
  const spec = validateBenchmark(parsed);
  // Resolve relative source paths against the benchmark file's directory.
  if (!path.isAbsolute(spec.source.path)) {
    spec.source.path = path.resolve(path.dirname(ref), spec.source.path);
  }
  return spec;
}

/** Validate the source exists and is within size bounds. */
export function validateSource(spec: BenchmarkSpec): void {
  const src = spec.source.path;
  if (!isDirectory(src)) {
    throw new HavrinError('NO_DATA', `Benchmark source directory not found: ${src}`);
  }
  if (spec.source.kind === 'git') {
    if (!isDirectory(path.join(src, '.git'))) {
      throw new HavrinError('USAGE', `Git benchmark source is not a git repository: ${src}`);
    }
    return;
  }
  let files = 0;
  let bytes = 0;
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files++;
        bytes += fs.statSync(full).size;
        if (files > MAX_TEMPLATE_FILES || bytes > MAX_TEMPLATE_BYTES) {
          throw new HavrinError('USAGE', `Benchmark template exceeds limits (${MAX_TEMPLATE_FILES} files / ${MAX_TEMPLATE_BYTES} bytes)`);
        }
      }
    }
  };
  walk(src);
  if (files === 0) throw new HavrinError('USAGE', `Benchmark template is empty: ${src}`);
}

/**
 * Fingerprint the benchmark source content (reproducibility + integrity).
 * For git sources: the HEAD commit hash. For templates: sorted file hashes.
 */
export function fingerprintSource(spec: BenchmarkSpec): string {
  if (spec.source.kind === 'git') {
    try {
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: spec.source.path,
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      return `git:${head}`;
    } catch (err) {
      throw new HavrinError('IO', `Cannot read git HEAD of benchmark source: ${errorMessage(err)}`);
    }
  }
  const entries: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(full, relPath);
      else if (entry.isFile()) {
        entries.push(`${relPath}:${sha256(fs.readFileSync(full, 'utf8'))}`);
      }
    }
  };
  walk(spec.source.path, '');
  return `template:${sha256(entries.join('\n'))}`;
}

/** Materialize a fresh, isolated trial workspace. Never touches the source. */
export function materializeWorkspace(spec: BenchmarkSpec, dest: string): void {
  if (fs.existsSync(dest)) {
    throw new HavrinError('IO', `Workspace already exists (refusing to overwrite): ${dest}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  if (spec.source.kind === 'git') {
    try {
      // Local clone, no hardlinks: fully independent object store, no network.
      execFileSync('git', ['clone', '--local', '--no-hardlinks', '--quiet', spec.source.path, dest], {
        timeout: 120_000,
        stdio: ['ignore', 'ignore', 'pipe'],
        maxBuffer: 1024 * 1024,
      });
    } catch (err) {
      throw new HavrinError('IO', `Git clone into workspace failed: ${errorMessage(err)}`);
    }
    return;
  }
  const copy = (dir: string, rel: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      const target = path.join(dest, rel, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(target, { recursive: true });
        copy(full, path.join(rel, entry.name));
      } else if (entry.isFile()) {
        fs.copyFileSync(full, target);
      }
    }
  };
  copy(spec.source.path, '');
}

/** Best-effort recursive removal of a trial workspace. */
export function removeWorkspace(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Workspace cleanup is best-effort; leftovers are reported, not fatal.
  }
}
