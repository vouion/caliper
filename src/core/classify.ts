import type { CommandCategory } from './types.ts';

/**
 * Coarse, privacy-preserving classification of shell/exec commands.
 * The raw command is classified and discarded; only the category is stored.
 *
 * Design (v0.2 review hardening):
 * - Shell-wrapper payloads (`bash -lc "npm test"`) are extracted and
 *   classified; the wrapper itself is not.
 * - Quoted spans elsewhere are arguments/messages, NOT execution: they are
 *   removed before classification so `echo "npm test"`, `grep pytest`,
 *   `git commit -m "npm test"` cannot masquerade as test runs.
 * - The command is split into pipeline/list segments; segments that are
 *   search/echo/printf invocations or `git commit` are classified by their
 *   own verb, never by their arguments.
 * - Conservative by contract: false negatives are acceptable; false "test"
 *   positives would suppress missing-test-verification findings.
 */

const B = '(^|\\s|\\()';
const E = '(\\s|$|[;&|)])';

/** Build a boundary-safe alternation: every branch gets its own trailing boundary. */
function alt(patterns: string[]): RegExp {
  return new RegExp(B + '(?:' + patterns.map((p) => p + E).join('|') + ')');
}

const TEST_RE = alt([
  'npm\\s+(run\\s+)?test',
  'npx\\s+(vitest|jest)',
  'pnpm\\s+(run\\s+)?test',
  'yarn\\s+test',
  'bun\\s+test',
  'deno\\s+test',
  'node\\s+--test',
  'pytest',
  'python[0-9.]*\\s+-m\\s+(pytest|unittest)',
  'go\\s+test',
  'cargo\\s+(test|nextest)',
  'make\\s+test',
  'ctest',
  'rspec',
  'mvn\\s+test',
  'gradle\\s+test',
  'dotnet\\s+test',
  'phpunit',
  'mix\\s+test',
  'swift\\s+test',
  'flutter\\s+test',
  'dart\\s+test',
  'jest',
  'vitest',
  'tox',
]);

const BUILD_RE = alt([
  'npm\\s+run\\s+build',
  'npx\\s+tsc',
  'pnpm\\s+(run\\s+)?build',
  'yarn\\s+build',
  'bun\\s+run\\s+build',
  'tsc',
  'make',
  'cargo\\s+build',
  'go\\s+build',
  'go\\s+vet',
  'mvn\\s+(package|compile)',
  'gradle\\s+build',
  'dotnet\\s+build',
  'cmake',
  'gcc',
  'g\\+\\+',
  'clang',
]);

const INSTALL_RE = alt([
  'npm\\s+(install|i|ci|add)',
  'pnpm\\s+(install|add|i)',
  'yarn\\s+(install|add)',
  'bun\\s+(install|add)',
  'pip[0-9.]*\\s+install',
  'uv\\s+(pip\\s+install|add|sync)',
  'cargo\\s+(add|install)',
  'go\\s+(get|install)',
  'apt(-get)?\\s+install',
  'brew\\s+install',
  'pacman\\s+-S',
]);

const GIT_RE = alt(['git']);
const SEARCH_RE = alt(['grep', 'rg', 'ag', 'ack', 'find', 'fd', 'ls', 'cat', 'head', 'tail', 'less', 'wc', 'tree', 'file', 'stat', 'du', 'which', 'whereis']);
const RUN_RE = alt([
  'node',
  'python[0-9.]*',
  'deno',
  'bun',
  'cargo\\s+run',
  'go\\s+run',
  'npm\\s+(run\\s+)?(start|dev)',
  'pnpm\\s+(run\\s+)?(start|dev)',
  'yarn\\s+(start|dev)',
  'docker',
  'kubectl',
]);

/** Segments whose arguments must never be classified as execution. */
const OPAQUE_ARG_VERB_RE = /^(echo|printf|grep|rg|ag|ack|git\s+commit|git\s+tag|git\s+log)\b/;

const WRAPPER_RE = /(?:^|[;&|]\s*|\s)(?:bash|sh|zsh|dash|\/bin\/(?:bash|sh|zsh))\s+(?:-[a-zA-Z]*c)\s+(["'])([\s\S]*?)\1/;

function classifySegment(segment: string): CommandCategory {
  const s = segment.trim().replace(/^\(+/, '').trim();
  if (s.length === 0) return 'other';
  if (OPAQUE_ARG_VERB_RE.test(s)) {
    if (/^git\b/.test(s)) return 'git';
    if (/^(grep|rg|ag|ack)\b/.test(s)) return 'search';
    return 'other';
  }
  if (TEST_RE.test(s)) return 'test';
  if (BUILD_RE.test(s)) return 'build';
  if (INSTALL_RE.test(s)) return 'install';
  if (GIT_RE.test(s)) return 'git';
  if (SEARCH_RE.test(s)) return 'search';
  if (RUN_RE.test(s)) return 'run';
  return 'other';
}

const RANK: Record<CommandCategory, number> = {
  test: 7,
  build: 6,
  install: 5,
  git: 4,
  search: 3,
  run: 2,
  other: 1,
};

export function classifyCommand(command: string): CommandCategory {
  // 1. Shell wrappers: classify the wrapped payload, not the wrapper.
  const wrapper = WRAPPER_RE.exec(command);
  if (wrapper?.[2]) {
    return classifyCommand(wrapper[2]);
  }
  // 2. Remove quoted spans (arguments/messages, not executed commands).
  const unquoted = command.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, ' ');
  // 3. Split into pipeline/list segments and classify each by its own verb.
  const segments = unquoted.split(/&&|\|\||[;|]/);
  let best: CommandCategory = 'other';
  for (const segment of segments) {
    const cat = classifySegment(segment);
    if (RANK[cat] > RANK[best]) best = cat;
  }
  return best;
}

/**
 * Extract a classifiable command string from structured tool input.
 * Handles {"command": ["bash","-lc","npm test"]} and {"command": "npm test"}
 * shapes without retaining the input itself. Array elements are joined with
 * spaces; the classifier's wrapper/quote handling keeps this safe.
 */
export function commandFromInput(input: unknown): string | undefined {
  if (typeof input === 'string') return input;
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const cmd = (input as Record<string, unknown>)['command'];
    if (typeof cmd === 'string') return cmd;
    if (Array.isArray(cmd)) {
      const parts = cmd.filter((p): p is string => typeof p === 'string');
      if (parts.length > 0) return parts.join(' ');
    }
  }
  return undefined;
}

/** Tool names that modify files, per agent conventions. */
const WRITE_TOOLS = new Set(['edit', 'write', 'apply_patch', 'patch', 'multiedit', 'notebookedit']);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name.toLowerCase());
}

const READ_TOOLS = new Set(['read', 'view', 'readfile', 'read_file']);

export function isReadTool(name: string): boolean {
  return READ_TOOLS.has(name.toLowerCase());
}
