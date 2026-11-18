/** Experiment report rendering (terminal + JSON), consistent with audit UX. */
import type { ExperimentComparison, ExperimentRecord } from './types.ts';
import { Painter, shouldUseColor } from '../report/terminal.ts';
import { formatDuration, formatTokens, formatCost, formatDate, sanitizeControlChars } from '../core/util.ts';

const safe = (t: string) => sanitizeControlChars(t);

function pad(text: string, width: number): string {
  const visible = text.replace(/\u001b\[[0-9;]*m/g, '');
  return text + ' '.repeat(Math.max(0, width - visible.length));
}

function padLeft(text: string, width: number): string {
  const visible = text.replace(/\u001b\[[0-9;]*m/g, '');
  return ' '.repeat(Math.max(0, width - visible.length)) + text;
}

export function renderExperimentTerminal(
  record: ExperimentRecord,
  comparison: ExperimentComparison,
  opts: { color?: boolean; width?: number } = {},
): string {
  const width = Math.min(opts.width ?? process.stdout.columns ?? 80, 100);
  const p = new Painter(opts.color ?? shouldUseColor(process.stdout.isTTY));
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const rule = p.dim('─'.repeat(width));

  push('');
  push(p.bold(`EXPERIMENT: ${safe(record.benchmark.title)}`));
  push(p.dim(`${record.id} · benchmark ${record.benchmark.id} · ${formatDate(record.createdAt)} · status ${record.status}`));
  if (record.configs.some((c) => c.agent === 'mock')) {
    push(p.yellow('Contains MOCK configurations — simulated results, not real agent runs.'));
  }
  push(rule);

  // Configurations
  push(p.bold('CONFIGURATIONS'));
  for (const config of record.configs) {
    const role = config.id === record.baselineConfigId ? 'baseline' : 'candidate';
    const bits = [config.agent, config.model, config.agentName].filter(Boolean).join(' · ');
    push(`  ${p.bold(safe(config.id))} ${p.dim(`(${role})`)} — ${safe(config.label)} · ${bits || config.agent}`);
    if (config.instructions) push(p.dim(`    instructions: "${safe(config.instructions).slice(0, 80)}${config.instructions.length > 80 ? '…' : ''}"`));
  }
  push(p.dim(`  trials/config: ${record.trialsPerConfig} · order seed: ${record.orderSeed} · timeout: ${formatDuration(record.benchmark.limits.timeoutMs)}`));
  push('');

  // Comparison table — short config-id headers, right-aligned numbers.
  const aggs = comparison.aggregates;
  const isBase = (id: string) => id === record.baselineConfigId;
  const headers = aggs.map((a) => safe(a.configId) + (isBase(a.configId) ? '*' : ''));
  const labelW = 18;
  let colW = Math.max(10, ...headers.map((h) => h.length)) + 2;
  while (2 + labelW + aggs.length * colW > width && colW > 10) colW--;
  const fitHeader = (h: string) => (h.length > colW ? h.slice(0, Math.max(1, colW - 1)) + '…' : h);

  push(p.bold('RESULTS'));
  let header = pad('Metric', labelW);
  for (const h of headers) header += padLeft(fitHeader(h), colW);
  push('  ' + p.bold(header));

  const row = (label: string, values: string[]) => {
    let line = pad(label, labelW);
    for (const v of values) line += padLeft(v, colW);
    push('  ' + line);
  };

  row('Task success', aggs.map((a) => (a.successRate === null ? '—' : `${a.successes}/${a.trials}`)));
  row('Avg time', aggs.map((a) => (a.executionMs ? formatDuration(a.executionMs.mean) : '—')));
  row('Time stddev', aggs.map((a) => (a.executionMs ? formatDuration(a.executionMs.stddev) : '—')));
  row('Input tokens', aggs.map((a) => (a.tokens ? formatTokens(a.tokens.input) : '—')));
  row('Output tokens', aggs.map((a) => (a.tokens ? formatTokens(a.tokens.output) : '—')));
  row('Cache read', aggs.map((a) => (a.tokens ? formatTokens(a.tokens.cacheRead) : '—')));
  row('Reported cost', aggs.map((a) => (a.cost === null ? '—' : formatCost(a.cost))));
  row('Tool calls', aggs.map((a) => (a.toolCalls === null ? '—' : String(a.toolCalls))));
  row('Tool errors', aggs.map((a) => (a.toolErrors === null ? '—' : String(a.toolErrors))));
  row('Test failures', aggs.map((a) => (a.testFailures === null ? '—' : String(a.testFailures))));
  row('Timeouts', aggs.map((a) => String(a.timeouts)));
  row('Exec errors', aggs.map((a) => String(a.errors)));
  push(p.dim('  * baseline · — = unavailable (not zero) · cost is agent-reported · tokens are per-trial sums'));
  push('');

  // Verdict
  const v = comparison.verdict;
  const winnerLabel = v.winnerConfigId ? aggs.find((a) => a.configId === v.winnerConfigId)?.label ?? v.winnerConfigId : null;
  push(p.bold('VERDICT'));
  if (winnerLabel) {
    const color = v.confidence === 'verified' ? p.green : p.yellow;
    push(`  Winner: ${color(p.bold(safe(winnerLabel)))} · confidence: ${color(v.confidence)}`);
  } else {
    push(`  Winner: ${p.yellow('none')} · confidence: ${p.yellow(v.confidence)}`);
  }
  push(`  Recommendation state: ${p.bold(v.recommendationState)}`);
  for (const reason of v.reasons) {
    push(...wrapText(reason, width, '    '));
  }
  if (v.tradeoffs.length > 0) {
    push(p.dim('  Trade-offs:'));
    for (const t of v.tradeoffs) push(...wrapText(t, width, '    '));
  }
  if (v.confidence !== 'verified') {
    push(p.dim('  Only verified results are experimentally proven improvements; this is not one (yet).'));
  }
  for (const u of comparison.unavailable) push(p.dim('  · ' + u));
  push('');

  // Trial log
  push(p.bold(`TRIALS (${record.trials.length})`));
  for (const trial of [...record.trials].sort((a, b) => a.order - b.order)) {
    const statusIcon =
      trial.verification?.success ? p.green('✓') : trial.status === 'completed' ? p.red('✗') : trial.status === 'timeout' ? p.yellow('⏱') : p.red('!');
    const bits = [
      trial.status,
      trial.executionMs !== undefined ? formatDuration(trial.executionMs) : undefined,
      trial.verification ? `${trial.verification.checks.filter((c) => c.passed).length}/${trial.verification.checks.length} checks` : undefined,
      trial.sessionMetrics ? `${formatTokens(trial.sessionMetrics.tokens.output)} out` : undefined,
    ].filter(Boolean).join(' · ');
    push(`  ${statusIcon} ${pad(trial.trialId, 24)} ${p.dim(bits)}`);
    if (trial.error) push(p.dim(`      error: ${safe(trial.error).slice(0, 120)}`));
  }
  push('');
  push(rule);
  push(p.dim('Privacy: no conversation content or credentials stored. Workspaces isolated per trial;'));
  push(p.dim('transient execution artifacts deleted. Benchmark source fingerprint: ' + record.benchmarkFingerprint.slice(0, 24) + '…'));
  push('');
  return out.join('\n');
}

function wrapText(text: string, width: number, indent: string): string[] {
  const words = safe(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  const max = Math.max(20, width - indent.length);
  for (const word of words) {
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= max) line += ' ' + word;
    else {
      lines.push(indent + line);
      line = word;
    }
  }
  if (line) lines.push(indent + line);
  return lines;
}
