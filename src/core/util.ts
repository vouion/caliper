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
  return JSON.stringify(sortValue(value)) ?? 'null';
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    // Null-prototype target: untrusted JSON may carry own "__proto__" keys;
    // a plain {} assignment would mutate the prototype instead of the record.
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|[A-Za-z0-9_-]*api[_-]?key[A-Za-z0-9_-]*\s*[:=]\s*\S+)/gi;

/**
 * Redact secret-looking substrings from short diagnostic strings.
 * Defense in depth: Havrin never intentionally ingests secret values, but
 * tool error messages may echo fragments of input.
 */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_VALUE_RE, '[REDACTED]');
}

/** Truncate + redact a tool-generated error message for evidence use. */
export function sanitizeErrorMessage(message: unknown, max = 200): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  const oneLine = message.replace(/\s+/g, ' ').trim();
  const cut = oneLine.length > max ? oneLine.slice(0, max) + '…' : oneLine;
  return redactSecrets(cut);
}

/** Keys whose VALUES must never be reported, even structurally. */
const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|passwd|credential|private[_-]?key|access[_-]?key|auth)/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key);
}

/** Parse relative durations like "30d", "12h", "90m", "7d12h" into ms. */
export function parseDuration(input: string): number | undefined {
  const re = /(\d+)\s*([dhms])/gi;
  let total = 0;
  let matched = false;
  let lastIndex = 0;
  for (const m of input.matchAll(re)) {
    if (m.index !== lastIndex) return undefined;
    const n = Number(m[1]);
    const unit = m[2]?.toLowerCase();
    const mult =
      unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000;
    total += n * mult;
    matched = true;
    lastIndex = m.index + m[0].length;
  }
  if (!matched || lastIndex !== input.trim().length) return undefined;
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

export function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
