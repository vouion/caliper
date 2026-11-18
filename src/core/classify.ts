import type { CommandCategory } from './types.ts';

/**
 * Coarse, privacy-preserving classification of shell/exec commands.
 * The raw command is classified and discarded; only the category is stored.
 * Patterns are intentionally conservative: false negatives are acceptable,
 * false "test" positives would undermine the missing-verification rule.
 *
 * The boundary class includes quotes so wrapped commands like
 * `bash -lc "npm test"` classify correctly. JSON-shaped inputs
 * ({"command":["npm","test"]}) must be unwrapped by the adapter first.
 */

const B = '(^|[;&|]\\s*|\\s|["\'])';

const TEST_RE = new RegExp(
  B +
    '(npm\\s+(run\\s+)?test|npx\\s+(vitest|jest)|pnpm\\s+(run\\s+)?test|yarn\\s+test|bun\\s+test|deno\\s+test|node\\s+--test|pytest|python[0-9.]*\\s+-m\\s+(pytest|unittest)|go\\s+test|cargo\\s+(test|nextest)|make\\s+test|ctest|rspec|mvn\\s+test|gradle\\s+test|dotnet\\s+test|phpunit|mix\\s+test|swift\\s+test|flutter\\s+test|dart\\s+test|jest|vitest|tox)(\\s|$|["\'])',
);

const BUILD_RE = new RegExp(
  B +
    '(npm\\s+run\\s+build|npx\\s+tsc|pnpm\\s+(run\\s+)?build|yarn\\s+build|bun\\s+run\\s+build|tsc|make(\\s|$)|cargo\\s+build|go\\s+build|go\\s+vet|mvn\\s+(package|compile)|gradle\\s+build|dotnet\\s+build|cmake|gcc|g\\+\\+|clang)(\\s|$|["\'])',
);

const INSTALL_RE = new RegExp(
  B +
    '(npm\\s+(install|i|ci|add)|pnpm\\s+(install|add|i)|yarn\\s+(install|add)|bun\\s+(install|add)|pip[0-9.]*\\s+install|uv\\s+(pip\\s+install|add|sync)|cargo\\s+(add|install)|go\\s+(get|install)|apt(-get)?\\s+install|brew\\s+install|pacman\\s+-S)(\\s|$|["\'])',
);

const GIT_RE = new RegExp(B + 'git(\\s|$|["\'])');

const SEARCH_RE = new RegExp(
  B + '(grep|rg|ag|find|fd|ls|cat|head|tail|less|wc|tree|file|stat|du|which|whereis)(\\s|$|["\'])',
);

const RUN_RE = new RegExp(
  B +
    '(node|python[0-9.]*|deno|bun|cargo\\s+run|go\\s+run|npm\\s+(run\\s+)?(start|dev)|pnpm\\s+(run\\s+)?(start|dev)|yarn\\s+(start|dev)|docker|kubectl|bash|sh|zsh)(\\s|$|["\'])',
);

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

/**
 * Extract a classifiable command string from structured tool input.
 * Handles {"command": ["bash","-lc","npm test"]} and {"command": "npm test"}
 * shapes without retaining the input itself.
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
