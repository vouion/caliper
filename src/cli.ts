#!/usr/bin/env node
/**
 * havrin CLI — doctor / audit / report / demo.
 * Exit codes: 0 success · 1 runtime failure (or doctor found failures) · 2 usage error.
 */
import { parseArgs } from 'node:util';
import type { AgentId } from './core/types.ts';
import { HavrinError, errorMessage } from './core/errors.ts';
import { parseDuration } from './core/util.ts';
import { runAudit, DEFAULT_SINCE_MS, DEFAULT_LIMIT } from './audit.ts';
import { runDoctor } from './doctor.ts';
import { runDemoAudit } from './demo/dataset.ts';
import { loadLastAudit } from './store.ts';
import { renderTerminal, shouldUseColor } from './report/terminal.ts';
import { HAVRIN_VERSION } from './version.ts';

const HELP = `havrin v${HAVRIN_VERSION} — local-first optimization engine for AI-powered development

USAGE
  havrin <command> [options]

COMMANDS
  doctor              Check runtime, agent installs, and session storage health
  audit               Analyze agent sessions + environment; print findings & recommendations
  report              Re-render the last audit (default: terminal)
  demo                Run the audit on clearly-labeled synthetic data
  help                Show this help
  version             Print version

AUDIT OPTIONS
  --agent <id>        Restrict to an agent: opencode | codex (repeatable)
  --since <duration>  Analysis window, e.g. 7d, 12h, 30d (default 30d)
  --all               Analyze all sessions regardless of age
  --limit <n>         Max sessions per agent (default ${DEFAULT_LIMIT}, max 1000)
  --no-cache          Force re-ingestion (bypass incremental cache)
  --project <dir>     Project dir for environment scan (default: cwd)
  --json              Print machine-readable JSON instead of the terminal report

REPORT OPTIONS
  --format <fmt>      json | terminal (default terminal)

GLOBAL OPTIONS
  --no-color          Disable ANSI colors (also honors NO_COLOR)
  --help, --version

PRIVACY
  All analysis is local. Session content and credentials are never transmitted.
  Agent data is opened read-only. Reports contain metrics and evidence pointers,
  not message text. State lives in ~/.local/share/havrin (override: HAVRIN_HOME).

EXAMPLES
  havrin doctor
  havrin audit --since 7d
  havrin audit --agent opencode --json > audit.json
  havrin report --format json
  havrin demo
`;

interface Parsed {
  values: Record<string, unknown>;
  positionals: string[];
}

function parse(argv: string[]): Parsed {
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        agent: { type: 'string', multiple: true },
        since: { type: 'string' },
        all: { type: 'boolean', default: false },
        limit: { type: 'string' },
        json: { type: 'boolean', default: false },
        format: { type: 'string' },
        'no-cache': { type: 'boolean', default: false },
        project: { type: 'string' },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
      },
    });
    return { values, positionals };
  } catch (err) {
    throw new HavrinError('USAGE', errorMessage(err), 'Run havrin help for usage.');
  }
}

function wantString(values: Record<string, unknown>, key: string): string | undefined {
  const v = values[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new HavrinError('USAGE', `--${key} requires a non-empty value`);
  }
  return v;
}

function main(argv: string[]): number {
  const { values, positionals } = parse(argv);
  const color = !values['no-color'] && shouldUseColor(process.stdout.isTTY);

  if (values['version']) {
    process.stdout.write(HAVRIN_VERSION + '\n');
    return 0;
  }
  const command = positionals[0];
  if (values['help'] || command === undefined || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (positionals.length > 1) {
    throw new HavrinError('USAGE', `Unexpected argument: ${positionals[1]}`, 'Run havrin help for usage.');
  }

  switch (command) {
    case 'version':
      process.stdout.write(HAVRIN_VERSION + '\n');
      return 0;

    case 'doctor': {
      const project = wantString(values, 'project');
      const result = runDoctor(project);
      const icon = { ok: color ? '\u001b[32m✓\u001b[0m' : '✓', warn: color ? '\u001b[33m▲\u001b[0m' : '▲', fail: color ? '\u001b[31m✗\u001b[0m' : '✗' };
      process.stdout.write(`havrin doctor — v${HAVRIN_VERSION}\n\n`);
      for (const check of result.checks) {
        process.stdout.write(`  ${icon[check.status]} ${check.name}\n`);
        process.stdout.write(`      ${check.detail}\n`);
      }
      const fails = result.checks.filter((c) => c.status === 'fail').length;
      const warns = result.checks.filter((c) => c.status === 'warn').length;
      process.stdout.write(`\n${fails === 0 ? 'All critical checks passed' : `${fails} check(s) failed`}${warns > 0 ? ` · ${warns} warning(s)` : ''}\n`);
      return result.exitCode;
    }

    case 'audit': {
      const agentsRaw = values['agent'];
      let agents: AgentId[] | undefined;
      if (Array.isArray(agentsRaw) && agentsRaw.length > 0) {
        agents = agentsRaw.map((a) => {
          if (a !== 'opencode' && a !== 'codex') {
            throw new HavrinError('USAGE', `Unknown agent: ${String(a)}`, 'Supported agents: opencode, codex');
          }
          return a;
        });
      }
      let sinceMs = DEFAULT_SINCE_MS;
      const since = wantString(values, 'since');
      if (values['all']) {
        sinceMs = Date.now(); // window.since ≈ 0
      } else if (since) {
        const ms = parseDuration(since);
        if (ms === undefined || ms <= 0) {
          throw new HavrinError('USAGE', `Invalid --since value: ${since}`, 'Use a duration like 12h, 7d, 30d.');
        }
        sinceMs = ms;
      }
      let limit = DEFAULT_LIMIT;
      const limitRaw = wantString(values, 'limit');
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
          throw new HavrinError('USAGE', `Invalid --limit value: ${limitRaw}`, 'Use an integer between 1 and 1000.');
        }
      }
      const project = wantString(values, 'project');
      const outcome = runAudit({
        ...(agents !== undefined ? { agents } : {}),
        sinceMs,
        limit,
        ...(project !== undefined ? { projectDir: project } : {}),
        noCache: values['no-cache'] === true,
      });
      if (values['json']) {
        for (const n of outcome.notices) process.stderr.write(`notice: ${n}\n`);
        process.stdout.write(JSON.stringify(outcome.report, null, 2) + '\n');
      } else {
        process.stdout.write(renderTerminal(outcome.report, { color }));
        if (outcome.notices.length > 0) {
          process.stdout.write('NOTICES\n');
          for (const n of outcome.notices) process.stdout.write(`  ▲ ${n}\n`);
          process.stdout.write('\n');
        }
      }
      return 0;
    }

    case 'report': {
      const format = wantString(values, 'format') ?? 'terminal';
      if (format !== 'json' && format !== 'terminal') {
        throw new HavrinError('USAGE', `Unknown format: ${format}`, 'Supported formats: json, terminal');
      }
      const report = loadLastAudit();
      if (!report) {
        throw new HavrinError('NO_AUDIT', 'No saved audit found.', 'Run havrin audit first (or havrin demo for synthetic data).');
      }
      if (format === 'json') {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(renderTerminal(report, { color }));
      }
      return 0;
    }

    case 'demo': {
      const report = runDemoAudit();
      if (values['json']) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(renderTerminal(report, { color }));
      }
      return 0;
    }

    default:
      throw new HavrinError('USAGE', `Unknown command: ${command}`, 'Run havrin help for usage.');
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof HavrinError) {
    process.stderr.write(`error[${err.code}]: ${err.message}\n`);
    if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
    process.exitCode = err.code === 'USAGE' ? 2 : 1;
  } else {
    process.stderr.write(`error[INTERNAL]: ${errorMessage(err)}\n`);
    if (process.env['HAVRIN_DEBUG']) process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n');
    process.exitCode = 1;
  }
}
