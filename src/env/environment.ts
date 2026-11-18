/**
 * Environment intelligence: discover agent configuration, MCP servers,
 * skills, and instruction files — structure only.
 *
 * Privacy contract: config VALUES that look like secrets are never retained
 * or reported; only the key path and file are recorded as exposures. MCP
 * server commands/env are never reported (they frequently embed secrets).
 * Instruction file contents are never read into reports; only path, size,
 * and content hash (for collision detection).
 */
import path from 'node:path';
import fs from 'node:fs';
import { parse as parseToml } from 'smol-toml';
import type { AgentId, EnvironmentInfo } from '../core/types.ts';
import { isSecretKey, sha256 } from '../core/util.ts';
import { isDirectory, isReadableFile, listSubdirs, readJsonFileOptional, xdgConfigHome } from '../core/fs.ts';
import { errorMessage } from '../core/errors.ts';
import { opencodeConfigDir } from '../adapters/opencode.ts';
import { codexHome } from '../adapters/codex.ts';

const INSTRUCTION_BASENAMES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.windsurfrules',
  'GEMINI.md',
  '.github/copilot-instructions.md',
];

export interface EnvironmentScanOptions {
  /** Project directory to scan for project-level config/instructions. Defaults to cwd. */
  projectDir?: string;
}

export function scanEnvironment(opts: EnvironmentScanOptions = {}): EnvironmentInfo {
  const projectDir = opts.projectDir ?? process.cwd();
  const info: EnvironmentInfo = {
    agents: [],
    mcpServers: [],
    skills: [],
    instructionFiles: [],
    secretExposures: [],
    warnings: [],
  };

  scanOpenCodeConfig(info);
  scanCodexConfig(info);
  scanSkills(info, projectDir);
  scanInstructionFiles(info, projectDir);
  return info;
}

function scanOpenCodeConfig(info: EnvironmentInfo): void {
  const configPath = path.join(opencodeConfigDir(), 'opencode.json');
  if (!isReadableFile(configPath)) return;
  let config: unknown;
  try {
    config = readJsonFileOptional(configPath);
  } catch (err) {
    info.warnings.push(`OpenCode config unreadable: ${errorMessage(err)}`);
    return;
  }
  if (config === undefined) return;
  const rec = asRecord(config);
  if (!rec) {
    info.warnings.push('OpenCode config is not a JSON object');
    return;
  }
  findSecretKeys(rec, '', configPath, info);

  // MCP servers: current shape is mcp.servers; older configs used mcp.<name>.
  const mcp = asRecord(rec['mcp']);
  const names = new Set<string>();
  if (mcp) {
    const servers = asRecord(mcp['servers']);
    for (const [name, value] of Object.entries(servers ?? mcp)) {
      if (name === 'servers') continue;
      const server = asRecord(value);
      if (!server) continue;
      // Disabled servers are still "configured"; note them as configured.
      names.add(name);
    }
  }
  if (names.size > 0) {
    info.mcpServers.push({ agent: 'opencode', configPath, names: [...names].sort() });
  }

  // Config-declared skill directories (array of paths).
  const skills = rec['skills'];
  if (Array.isArray(skills)) {
    for (const entry of skills) {
      if (typeof entry === 'string' && entry.length > 0) {
        const dir = path.isAbsolute(entry) ? entry : path.join(opencodeConfigDir(), entry);
        addSkillDir(info, 'opencode', dir);
      }
    }
  }
}

function scanCodexConfig(info: EnvironmentInfo): void {
  const configPath = path.join(codexHome(), 'config.toml');
  if (!isReadableFile(configPath)) return;
  let config: unknown;
  try {
    config = parseToml(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    info.warnings.push(`Codex config.toml unreadable: ${errorMessage(err)}`);
    return;
  }
  const rec = asRecord(config);
  if (!rec) return;
  findSecretKeys(rec, '', configPath, info);

  const mcp = asRecord(rec['mcp_servers']);
  if (mcp) {
    const names = Object.keys(mcp).sort();
    if (names.length > 0) info.mcpServers.push({ agent: 'codex', configPath, names });
  }
}

function scanSkills(info: EnvironmentInfo, projectDir: string): void {
  const candidates: { agent: AgentId | 'shared'; dir: string }[] = [
    { agent: 'opencode', dir: path.join(opencodeConfigDir(), 'skills') },
    { agent: 'opencode', dir: path.join(projectDir, '.opencode', 'skills') },
    { agent: 'codex', dir: path.join(codexHome(), 'skills') },
    { agent: 'shared', dir: path.join(process.env['HOME'] ?? '', '.agents', 'skills') },
  ];
  for (const c of candidates) addSkillDir(info, c.agent, c.dir);
}

function addSkillDir(info: EnvironmentInfo, agent: AgentId | 'shared', dir: string): void {
  if (!isDirectory(dir)) return;
  if (info.skills.some((s) => s.dir === dir)) return;
  const ids = listSubdirs(dir).filter((name) => !name.startsWith('.'));
  info.skills.push({ agent, dir, ids });
}

function scanInstructionFiles(info: EnvironmentInfo, projectDir: string): void {
  const candidates = [
    path.join(xdgConfigHome(), 'opencode', 'AGENTS.md'),
    path.join(codexHome(), 'AGENTS.md'),
    path.join(process.env['HOME'] ?? '', '.claude', 'CLAUDE.md'),
    ...INSTRUCTION_BASENAMES.map((name) => path.join(projectDir, name)),
  ];
  const seen = new Set<string>();
  for (const file of candidates) {
    const resolved = path.resolve(file);
    if (seen.has(resolved) || !isReadableFile(file)) continue;
    seen.add(resolved);
    try {
      const content = fs.readFileSync(file);
      info.instructionFiles.push({
        path: resolved,
        bytes: content.byteLength,
        sha256: sha256(content.toString('utf8')),
      });
    } catch {
      // Unreadable instruction file: skip silently; doctor reports permissions.
    }
  }
}

/** Recursively record secret-looking keys with non-empty scalar values. */
function findSecretKeys(
  value: unknown,
  keyPath: string,
  configPath: string,
  info: EnvironmentInfo,
  depth = 0,
): void {
  if (depth > 8) return;
  const rec = asRecord(value);
  if (!rec) return;
  for (const [key, child] of Object.entries(rec)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key;
    if (isSecretKey(key) && typeof child === 'string' && child.trim().length > 0) {
      // env-var references like {env:FOO} are not exposures.
      if (!/^\{env:[^}]+\}$/.test(child.trim())) {
        info.secretExposures.push({ configPath, keyPath: childPath });
      }
    }
    findSecretKeys(child, childPath, configPath, info, depth + 1);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
