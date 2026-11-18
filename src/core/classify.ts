import type { CommandCategory } from './types.ts';

/**
 * Coarse, privacy-preserving classification of shell/exec commands.
 * The raw command is classified and discarded; only the category is stored.
 * Patterns are intentionally conservative: false negatives are acceptable,
 * false "test" positives would undermine the missing-verification rule.
 */

const TEST_RE =
  /(^|[;&|]\s*|\s)(npm\s+(run\s+)?test|npx\s+(vitest|jest)|pnpm\s+(run\s+)?test|yarn\s+test|bun\s+test|deno\s+test|node\s+--test|pytest|python[0-9.]*\s+-m\s+(pytest|unittest)|go\s+test|cargo\s+(test|nextest)|make\s+test|ctest|rspec|mvn\s+test|gradle\s+test|dotnet\s+test|phpunit|mix\s+test|swift\s+test|flutter\s+test|dart\s+test|jest|vitest|tox)(\s|$)/;

const BUILD_RE =
  /(^|[;&|]\s*|\s)(npm\s+run\s+build|npx\s+tsc|pnpm\s+(run\s+)?build|yarn\s+build|bun\s+run\s+build|tsc|make(\s|$)|cargo\s+build|go\s+build|go\s+vet|mvn\s+(package|compile)|gradle\s+build|dotnet\s+build|cmake|gcc|g\+\+|clang)(\s|$)/;

const INSTALL_RE =
  /(^|[;&|]\s*|\s)(npm\s+(install|i|ci|add)|pnpm\s+(install|add|i)|yarn\s+(install|add)|bun\s+(install|add)|pip[0-9.]*\s+install|uv\s+(pip\s+install|add|sync)|cargo\s+(add|install)|go\s+(get|install)|apt(-get)?\s+install|brew\s+install|pacman\s+-S)(\s|$)/;

const GIT_RE = /(^|[;&|]\s*|\s)git(\s|$)/;

const SEARCH_RE =
  /(^|[;&|]\s*|\s)(grep|rg|ag|find|fd|ls|cat|head|tail|less|wc|tree|file|stat|du|which|whereis)(\s|$)/;

const RUN_RE =
  /(^|[;&|]\s*|\s)(node|python[0-9.]*|deno|bun|cargo\s+run|go\s+run|npm\s+(run\s+)?(start|dev)|pnpm\s+(run\s+)?(start|dev)|yarn\s+(start|dev)|docker|kubectl)(\s|$)/;

export function classifyCommand(command: string): CommandCategory {
  // Check the whole pipeline: a test anywhere in the command counts as test.
  if (TEST_RE.test(command)) return 'test';
  if (BUILD_RE.test(command)) return 'build';
  if (INSTALL_RE.test(command)) return 'install';
  if (GIT_RE.test(command)) return 'git';
  if (SEARCH_RE.test(command)) return 'search';
  if (RUN_RE.test(command)) return 'run';
  return 'other';
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
