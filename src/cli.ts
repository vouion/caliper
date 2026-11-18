#!/usr/bin/env node
/**
 * caliper CLI — doctor / audit / report / demo.
 * Exit codes: 0 success · 1 runtime failure (or doctor found failures) · 2 usage error.
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import type { AgentId, Severity } from './core/types.ts';
import { CaliperError, errorMessage } from './core/errors.ts';
import { parseDuration, plural } from './core/util.ts';
import { readJsonFile } from './core/fs.ts';
import { runAudit, DEFAULT_SINCE_MS, DEFAULT_LIMIT } from './audit.ts';
import { runDoctor } from './doctor.ts';
import { runDemoAudit } from './demo/dataset.ts';
import { loadLastAudit } from './store.ts';
import { buildFixPrompt, selectRecommendations, type PromptAgent } from './optimize/prompt.ts';
import { renderTerminal, shouldUseColor } from './report/terminal.ts';
import { createExperiment, runExperiment } from './experiment/runner.ts';
import { listExperiments, loadExperiment } from './experiment/store.ts';
import { compareExperiment } from './experiment/compare.ts';
import { renderExperimentTerminal } from './experiment/report.ts';
import { runExperimentDemo } from './experiment/demo.ts';
import { CALIPER_VERSION } from './version.ts';

const HELP = `caliper v${CALIPER_VERSION} — local-first optimization engine for AI-powered development

USAGE
  caliper <command> [options]

COMMANDS
  doctor              Check runtime, agent installs, and session storage health
  audit               Analyze agent sessions + environment; print findings & recommendations
  report              Re-render the last audit (default: terminal)
  prompt              Generate an agent-ready prompt to apply the audit's fixes
  demo                Run the audit on clearly-labeled synthetic data
  experiment          Reproducible configuration experiments (see below)
  help                Show this help
  version             Print version

EXPERIMENT SUBCOMMANDS
  caliper experiment list                     List registered experiments
  caliper experiment create --benchmark <ref> --baseline <config.json>
      --candidate <config.json> [--trials N] [--seed N] [--recommendation <id>]
      ref: builtin:fix-failing-test or a benchmark JSON file path
  caliper experiment run <id> [--approve-inference] [--allow-unverified]
      [--dry-run] [--keep-workspaces] [--timeout <ms>]
      Real agents perform PAID inference; --approve-inference is required.
  caliper experiment report <id> [--format json|terminal]
  caliper experiment inspect <id>             Full experiment record (JSON)
  caliper experiment demo                     Free mock experiment, end-to-end

AUDIT OPTIONS
  --agent <id>        Restrict to an agent: opencode | codex | claude (repeatable)
  --since <duration>  Analysis window, e.g. 7d, 12h, 30d (default 30d)
  --all               Analyze all sessions regardless of age
  --limit <n>         Max sessions per agent (default ${DEFAULT_LIMIT}, max 1000)
  --no-cache          Force re-ingestion (bypass incremental cache)
  --project <dir>     Project dir for environment scan (default: cwd)
  --json              Print machine-readable JSON instead of the terminal report

REPORT OPTIONS
  --format <fmt>      json | terminal (default terminal; --json is an alias)

PROMPT OPTIONS
  --agent <id>        Tailor instruction-file refs: generic | opencode | codex | claude
                      (default generic)
  --min-severity <s>  Include fixes at or above: low | medium | high (default low)
  --output <file>     Write the prompt to a file instead of stdout
  --demo              Build from synthetic demo data (no saved audit needed)
  --json              Emit { agent, minSeverity, recommendationCount, prompt, ... }

GLOBAL OPTIONS
  --no-color          Disable ANSI colors (also honors NO_COLOR)
  --help, --version

PRIVACY
  All analysis is local. Session content and credentials are never transmitted.
  Agent data is opened read-only. Reports contain metrics and evidence pointers,
  not message text. State lives in ~/.local/share/caliper (override: CALIPER_HOME).

EXAMPLES
  caliper doctor
  caliper audit --since 7d
  caliper audit --agent opencode --json > audit.json
  caliper report --format json
  caliper prompt --agent claude --output fix.md
  caliper prompt --demo
  caliper demo
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
        'min-severity': { type: 'string' },
        output: { type: 'string' },
        demo: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
        version: { type: 'boolean', default: false },
        benchmark: { type: 'string' },
        baseline: { type: 'string' },
        candidate: { type: 'string', multiple: true },
        trials: { type: 'string' },
        seed: { type: 'string' },
        recommendation: { type: 'string', multiple: true },
        'approve-inference': { type: 'boolean', default: false },
        'allow-unverified': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'keep-workspaces': { type: 'boolean', default: false },
        timeout: { type: 'string' },
      },
    });
    return { values, positionals };
  } catch (err) {
    throw new CaliperError('USAGE', errorMessage(err), 'Run caliper help for usage.');
  }
}

function wantString(values: Record<string, unknown>, key: string): string | undefined {
  const v = values[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.length === 0) {
    throw new CaliperError('USAGE', `--${key} requires a non-empty value`);
  }
  return v;
}

function main(argv: string[]): number | Promise<number> {
  const { values, positionals } = parse(argv);
  const color = !values['no-color'] && shouldUseColor(process.stdout.isTTY);

  if (values['version']) {
    process.stdout.write(CALIPER_VERSION + '\n');
    return 0;
  }
  const command = positionals[0];
  if (values['help'] || command === undefined || command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const maxPositionals = command === 'experiment' ? 3 : 1;
  if (positionals.length > maxPositionals) {
    throw new CaliperError('USAGE', `Unexpected argument: ${positionals[maxPositionals]}`, 'Run caliper help for usage.');
  }

  switch (command) {
    case 'version':
      process.stdout.write(CALIPER_VERSION + '\n');
      return 0;

    case 'doctor': {
      const project = wantString(values, 'project');
      const result = runDoctor(project);
      const icon = { ok: color ? '\u001b[32m✓\u001b[0m' : '✓', warn: color ? '\u001b[33m▲\u001b[0m' : '▲', fail: color ? '\u001b[31m✗\u001b[0m' : '✗' };
      process.stdout.write(`caliper doctor — v${CALIPER_VERSION}\n\n`);
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
          if (a !== 'opencode' && a !== 'codex' && a !== 'claude') {
            throw new CaliperError('USAGE', `Unknown agent: ${String(a)}`, 'Supported agents: opencode, codex, claude');
          }
          return a;
        });
      }
      let sinceMs = DEFAULT_SINCE_MS;
      const since = wantString(values, 'since');
      if (values['all'] && since) {
        throw new CaliperError('USAGE', '--all and --since are mutually exclusive', 'Use --all for full history, or --since <duration> for a window.');
      }
      if (values['all']) {
        sinceMs = Date.now(); // window.since ≈ 0
      } else if (since) {
        const ms = parseDuration(since);
        if (ms === undefined || ms <= 0) {
          throw new CaliperError('USAGE', `Invalid --since value: ${since}`, 'Use a duration like 12h, 7d, 30d.');
        }
        sinceMs = ms;
      }
      let limit = DEFAULT_LIMIT;
      const limitRaw = wantString(values, 'limit');
      if (limitRaw !== undefined) {
        limit = Number(limitRaw);
        if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
          throw new CaliperError('USAGE', `Invalid --limit value: ${limitRaw}`, 'Use an integer between 1 and 1000.');
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
      const formatRaw = wantString(values, 'format') ?? (values['json'] ? 'json' : 'terminal');
      const format = formatRaw;
      if (format !== 'json' && format !== 'terminal') {
        throw new CaliperError('USAGE', `Unknown format: ${format}`, 'Supported formats: json, terminal');
      }
      const report = loadLastAudit();
      if (!report) {
        throw new CaliperError('NO_AUDIT', 'No saved audit found.', 'Run caliper audit first (or caliper demo for synthetic data).');
      }
      if (format === 'json') {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        process.stdout.write(renderTerminal(report, { color }));
      }
      return 0;
    }

    case 'prompt': {
      // The shared --agent option is repeatable (for audit); prompt uses the first.
      const agentRaw = Array.isArray(values['agent']) ? (values['agent'] as string[])[0] : undefined;
      let agent: PromptAgent = 'generic';
      if (agentRaw !== undefined) {
        if (agentRaw !== 'generic' && agentRaw !== 'opencode' && agentRaw !== 'codex' && agentRaw !== 'claude') {
          throw new CaliperError('USAGE', `Unknown prompt agent: ${agentRaw}`, 'Supported: generic, opencode, codex, claude');
        }
        agent = agentRaw;
      }
      const sevRaw = wantString(values, 'min-severity') ?? 'low';
      if (sevRaw !== 'low' && sevRaw !== 'medium' && sevRaw !== 'high' && sevRaw !== 'info') {
        throw new CaliperError('USAGE', `Invalid --min-severity: ${sevRaw}`, 'Use low, medium, or high.');
      }
      const minSeverity = sevRaw as Severity;

      const report = values['demo'] === true ? runDemoAudit() : loadLastAudit();
      if (!report) {
        throw new CaliperError('NO_AUDIT', 'No saved audit found.', 'Run caliper audit first, or use caliper prompt --demo for synthetic data.');
      }
      const prompt = buildFixPrompt(report, { agent, minSeverity });
      const recommendationCount = selectRecommendations(report, minSeverity).length;
      const output = wantString(values, 'output');
      if (output !== undefined) {
        try {
          fs.writeFileSync(output, prompt, 'utf8');
        } catch (err) {
          throw new CaliperError('IO', `Could not write prompt to ${output}: ${errorMessage(err)}`);
        }
      }
      if (values['json']) {
        const payload = {
          agent,
          minSeverity,
          mode: report.mode,
          findingCount: report.findings.length,
          recommendationCount,
          ...(output !== undefined ? { output } : {}),
          prompt,
        };
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
      } else if (output !== undefined) {
        process.stdout.write(`Wrote prompt to ${output} (${plural(recommendationCount, 'recommendation')}, agent ${agent}).\n`);
      } else {
        process.stdout.write(prompt);
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

    case 'experiment':
      return experimentCommand(positionals, values, color);

    default:
      throw new CaliperError('USAGE', `Unknown command: ${command}`, 'Run caliper help for usage.');
  }
}

async function experimentCommand(
  positionals: string[],
  values: Record<string, unknown>,
  color: boolean,
): Promise<number> {
  const sub = positionals[1];
  const wantId = (): string => {
    const id = positionals[2];
    if (!id) throw new CaliperError('USAGE', 'experiment requires an id', 'Run caliper experiment list to see ids.');
    return id;
  };
  const asJson = values['json'] === true || values['format'] === 'json';

  switch (sub) {
    case undefined:
    case 'help':
      process.stdout.write(HELP);
      return 0;

    case 'list': {
      const entries = listExperiments();
      if (entries.length === 0) {
        process.stdout.write('No experiments yet. Create one with caliper experiment create, or try caliper experiment demo.\n');
        return 0;
      }
      process.stdout.write('EXPERIMENTS\n');
      process.stdout.write(`  ${'ID'.padEnd(28)}${'STATUS'.padEnd(12)}${'BENCHMARK'.padEnd(22)}TRIALS\n`);
      for (const e of entries) {
        process.stdout.write(`  ${e.id.padEnd(28)}${e.status.padEnd(12)}${e.benchmarkId.padEnd(22)}${String(e.trials).padStart(6)}\n`);
      }
      return 0;
    }

    case 'create': {
      const benchmarkRef = wantString(values, 'benchmark');
      const baselineFile = wantString(values, 'baseline');
      const candidateFiles = values['candidate'];
      if (!benchmarkRef || !baselineFile || !Array.isArray(candidateFiles) || candidateFiles.length === 0) {
        throw new CaliperError('USAGE', 'create requires --benchmark, --baseline, and at least one --candidate', 'See caliper help for the experiment syntax.');
      }
      let trials: number | undefined;
      const trialsRaw = wantString(values, 'trials');
      if (trialsRaw !== undefined) {
        trials = Number(trialsRaw);
        if (!Number.isInteger(trials) || trials < 1 || trials > 20) {
          throw new CaliperError('USAGE', `Invalid --trials: ${trialsRaw}`, 'Use an integer between 1 and 20.');
        }
      }
      let seed: number | undefined;
      const seedRaw = wantString(values, 'seed');
      if (seedRaw !== undefined) {
        seed = Number(seedRaw);
        if (!Number.isInteger(seed) || seed < 0) throw new CaliperError('USAGE', `Invalid --seed: ${seedRaw}`);
      }
      const recommendationIds = Array.isArray(values['recommendation']) ? (values['recommendation'] as string[]) : [];
      const record = createExperiment({
        benchmarkRef,
        baseline: readJsonFile(baselineFile),
        candidates: candidateFiles.map((f) => readJsonFile(String(f))),
        ...(trials !== undefined ? { trialsPerConfig: trials } : {}),
        ...(seed !== undefined ? { orderSeed: seed } : {}),
        recommendationIds,
      });
      process.stdout.write(`Created experiment ${record.id}\n`);
      process.stdout.write(`  benchmark: ${record.benchmark.id} (${record.benchmarkFingerprint.slice(0, 24)}…)\n`);
      process.stdout.write(`  configs: ${record.configs.map((c) => `${c.id}=${c.agent}`).join(', ')} · trials/config: ${record.trialsPerConfig}\n`);
      const needsApproval = record.configs.some((c) => c.agent !== 'mock');
      process.stdout.write(`  next: caliper experiment run ${record.id}${needsApproval ? ' --approve-inference' : ''}\n`);
      return 0;
    }

    case 'run': {
      const id = wantId();
      let timeoutMs: number | undefined;
      const timeoutRaw = wantString(values, 'timeout');
      if (timeoutRaw !== undefined) {
        timeoutMs = Number(timeoutRaw);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) {
          throw new CaliperError('USAGE', `Invalid --timeout: ${timeoutRaw}`, 'Milliseconds between 1000 and 3600000.');
        }
      }
      const outcome = await runExperiment(id, {
        approveInference: values['approve-inference'] === true,
        allowUnverified: values['allow-unverified'] === true,
        dryRun: values['dry-run'] === true,
        keepWorkspaces: values['keep-workspaces'] === true,
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      });
      if (outcome.dryRunPlan) {
        process.stdout.write(`DRY RUN — experiment ${id} (no execution, no inference)\n`);
        for (const t of outcome.dryRunPlan) {
          process.stdout.write(`  order ${t.order}: ${t.trialId} (${t.agent})\n`);
        }
        if (outcome.record.configs.some((c) => c.agent !== 'mock')) {
          process.stdout.write('Real runs require --approve-inference (paid model inference).\n');
        }
        return 0;
      }
      for (const n of outcome.notices) process.stderr.write(`notice: ${n}\n`);
      if (asJson) {
        process.stdout.write(JSON.stringify({ record: outcome.record, comparison: outcome.comparison }, null, 2) + '\n');
      } else {
        process.stdout.write(renderExperimentTerminal(outcome.record, outcome.comparison, { color }));
      }
      return 0;
    }

    case 'report': {
      const record = loadExperiment(wantId());
      const comparison = compareExperiment(record);
      if (asJson) {
        process.stdout.write(JSON.stringify({ record, comparison }, null, 2) + '\n');
      } else {
        process.stdout.write(renderExperimentTerminal(record, comparison, { color }));
      }
      return 0;
    }

    case 'inspect': {
      const record = loadExperiment(wantId());
      process.stdout.write(JSON.stringify(record, null, 2) + '\n');
      return 0;
    }

    case 'demo': {
      const { record, comparison } = await runExperimentDemo();
      if (asJson) {
        process.stdout.write(JSON.stringify({ record, comparison }, null, 2) + '\n');
      } else {
        process.stdout.write(renderExperimentTerminal(record, comparison, { color }));
      }
      return 0;
    }

    default:
      throw new CaliperError('USAGE', `Unknown experiment subcommand: ${sub}`, 'Use list, create, run, report, inspect, or demo.');
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof CaliperError) {
    process.stderr.write(`error[${err.code}]: ${err.message}\n`);
    if (err.hint) process.stderr.write(`hint: ${err.hint}\n`);
    process.exitCode = err.code === 'USAGE' ? 2 : 1;
  } else {
    process.stderr.write(`error[INTERNAL]: ${errorMessage(err)}\n`);
    if (process.env['CALIPER_DEBUG']) process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n');
    process.exitCode = 1;
  }
}
