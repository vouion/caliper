import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HavrinError, errorMessage } from './errors.ts';

export function homeDir(): string {
  return os.homedir();
}

/** XDG base dirs with conventional fallbacks. */
export function xdgDataHome(): string {
  const env = process.env['XDG_DATA_HOME'];
  if (env && path.isAbsolute(env)) return env;
  return path.join(homeDir(), '.local', 'share');
}

export function xdgConfigHome(): string {
  const env = process.env['XDG_CONFIG_HOME'];
  if (env && path.isAbsolute(env)) return env;
  return path.join(homeDir(), '.config');
}

/** Havrin state directory. HAVRIN_HOME override exists for tests and advanced use. */
export function havrinHome(): string {
  const env = process.env['HAVRIN_HOME'];
  if (env && path.isAbsolute(env)) return env;
  return path.join(xdgDataHome(), 'havrin');
}

export function readJsonFile(file: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new HavrinError('IO', `Cannot read ${file}: ${errorMessage(err)}`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // Never include the parser's message: V8 embeds source snippets, which
    // could carry secrets from a malformed config into warnings/reports.
    throw new HavrinError('PARSE', `Invalid JSON in ${file}`);
  }
}

/** Read a JSON file if present; return undefined when missing. Other errors throw. */
export function readJsonFileOptional(file: string): unknown | undefined {
  if (!fs.existsSync(file)) return undefined;
  return readJsonFile(file);
}

/** Atomic write: tmp file in same directory + rename. Creates parent dirs. */
export function writeJsonAtomic(file: string, value: unknown): void {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* best effort cleanup */
    }
    throw new HavrinError('IO', `Cannot write ${file}: ${errorMessage(err)}`);
  }
}

export function isReadableFile(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

export function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** Locate an executable on PATH without spawning anything. */
export function whichSync(name: string): string | undefined {
  if (name.includes('/')) return isExecutable(name) ? name : undefined;
  const pathEnv = process.env['PATH'] ?? '';
  const exts = process.platform === 'win32' ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** List immediate subdirectory names, sorted; [] when dir missing/unreadable. */
export function listSubdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
