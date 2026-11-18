import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable fingerprint of a tool input. Keys are sorted recursively so
 * semantically identical inputs hash identically regardless of key order.
 * Non-serializable values fall back to a type tag.
 */
export function fingerprint(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value, 0)) ?? 'null';
}

const MAX_CANONICAL_DEPTH = 256;

function sortValue(value: unknown, depth: number): unknown {
  // Depth cap: hostile/pathological inputs must not overflow the stack.
  // Deep subtrees collapse to a stable marker (deterministic, content-free).
  if (depth > MAX_CANONICAL_DEPTH) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => sortValue(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    // Null-prototype target: untrusted JSON may carry own "__proto__" keys;
    // a plain {} assignment would mutate the prototype instead of the record.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return value;
}

const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*\s*[:=]\s*\S+)/gi;

/**
 * Redact secret-looking substrings from short diagnostic strings.
 * Defense in depth: Caliper never intentionally ingests secret values, but
 * tool error messages may echo fragments of input.
 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_VALUE_RE, '[REDACTED]');
}

/** Truncate + redact a tool-generated error message for evidence use. */
export function sanitizeErrorMessage(message: unknown, max = 200): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  const oneLine = message.replace(/\s+/g, ' ').trim();
  // Redact BEFORE truncating: a secret straddling the cut boundary would
  // otherwise survive as a partial prefix that no longer matches the shapes.
  const redacted = redactSecrets(oneLine);
  return redacted.length > max ? redacted.slice(0, max) + '…' : redacted;
}

/** Keys whose VALUES must never be reported, even structurally. */
const SECRET_KEY_RE =
  /(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|access[_-]?key|authorization|authentication|auth[_-]?token|oauth)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/**
 * Strip C0/C1 control characters (including ESC, BEL, CR, LF, CSI) from
 * free text destined for terminal rendering. Titles and paths are
 * attacker-influenceable (LLM-summarized titles, crafted filenames); raw
 * escape sequences would enable terminal spoofing / OSC abuse.
 * Tabs are preserved as single spaces for readability.
 */
export function sanitizeControlChars(text: string): string {
  return text
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

/** Safe free text for reports: control-free, secret-redacted, bounded. */
export function sanitizeFreeText(text: string, max = 200): string {
  const cleaned = sanitizeControlChars(text).replace(/\s+/g, ' ').trim();
  const redacted = redactSecrets(cleaned);
  return redacted.length > max ? redacted.slice(0, max) + '…' : redacted;
}

/** Parse relative durations like "30d", "12h", "90m", "7d12h" into ms. */
export function parseDuration(input: string): number | undefined {
  const trimmed = input.trim();
  const re = /(\d+)\s*([dhms])/gi;
  let total = 0;
  let matched = false;
  let lastIndex = 0;
  for (const m of trimmed.matchAll(re)) {
    if (m.index !== lastIndex) return undefined;
    const n = Number(m[1]);
    const unit = m[2]?.toLowerCase();
    const mult =
      unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000;
    total += n * mult;
    matched = true;
    lastIndex = m.index + m[0].length;
  }
  if (!matched || lastIndex !== trimmed.length) return undefined;
  return total;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** "1 turn" / "2 turns" — correct singular/plural for count nouns. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? singular + 's')}`;
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
