/**
 * caliper doctor — read-only health checks of the runtime, agent installs,
 * session storage, and Caliper's own state directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ADAPTERS } from './audit.ts';
import { probeDatabase, opencodeDbPath } from './adapters/opencode.ts';
import { caliperHome } from './core/fs.ts';
import { scanEnvironment } from './env/environment.ts';
import { CALIPER_VERSION } from './version.ts';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  exitCode: number;
}

export function runDoctor(projectDir?: string): DoctorResult {
  const checks: DoctorCheck[] = [];

  // Runtime
  const [majorRaw, minorRaw] = process.versions.node.split('.');
  const major = Number(majorRaw);
  const minor = Number(minorRaw);
  const nodeOk = major > 22 || (major === 22 && minor >= 13);
  checks.push({
    name: 'Node.js runtime',
    status: nodeOk ? 'ok' : 'fail',
    detail: `v${process.versions.node} (requires ≥ 22.13 for built-in SQLite)`,
  });
  checks.push({
    name: 'Caliper version',
    status: 'ok',
    detail: `v${CALIPER_VERSION} · platform ${process.platform}/${process.arch}`,
  });

  // Agent installations
  for (const adapter of ADAPTERS) {
    let inst;
    try {
      inst = adapter.detect();
    } catch (err) {
      checks.push({
        name: `${adapter.id}: detection`,
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (!inst.binaryPath && !inst.dataDir) {
      checks.push({
        name: `${adapter.id}: installation`,
        status: 'warn',
        detail: 'not detected (no binary on PATH, no data directory)',
      });
      continue;
    }
    const bits: string[] = [];
    if (inst.binaryPath) bits.push(`binary ${inst.binaryPath}`);
    if (inst.version) bits.push(`v${inst.version}`);
    if (inst.dataDir) bits.push(`data ${inst.dataDir}`);
    if (inst.layout) bits.push(`layout ${inst.layout}`);
    if (inst.sessionCount !== undefined) bits.push(`${inst.sessionCount} sessions`);
    checks.push({
      name: `${adapter.id}: installation`,
      status: inst.issues.length > 0 ? 'warn' : 'ok',
      detail: bits.join(' · '),
    });
    for (const issue of inst.issues) {
      checks.push({ name: `${adapter.id}: issue`, status: 'warn', detail: issue });
    }
    if (inst.configPath) {
      checks.push({ name: `${adapter.id}: config`, status: 'ok', detail: inst.configPath });
    }
  }

  // OpenCode database readability (the one storage that can be locked)
  const dbPath = opencodeDbPath();
  if (fs.existsSync(dbPath)) {
    const probe = probeDatabase(dbPath);
    checks.push({
      name: 'opencode: database read-only probe',
      status: probe.ok ? 'ok' : 'fail',
      detail: probe.detail,
    });
  }

  // Environment scan warnings
  const env = scanEnvironment(projectDir ? { projectDir } : {});
  for (const w of env.warnings) {
    checks.push({ name: 'environment', status: 'warn', detail: w });
  }
  if (env.secretExposures.length > 0) {
    checks.push({
      name: 'environment: plaintext secrets',
      status: 'warn',
      detail: `${env.secretExposures.length} secret-looking config value(s); run caliper audit for details`,
    });
  }

  // Caliper state dir writability
  const home = caliperHome();
  try {
    fs.mkdirSync(home, { recursive: true });
    const probe = path.join(home, `.doctor-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok', { mode: 0o600 });
    fs.unlinkSync(probe);
    checks.push({ name: 'caliper: state directory', status: 'ok', detail: `${home} (writable)` });
  } catch (err) {
    checks.push({
      name: 'caliper: state directory',
      status: 'fail',
      detail: `${home}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const exitCode = checks.some((c) => c.status === 'fail') ? 1 : 0;
  return { checks, exitCode };
}
