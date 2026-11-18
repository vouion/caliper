import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, redactSecrets, sanitizeErrorMessage, fingerprint, formatTokens, isSecretKey } from '../src/core/util.ts';
import { classifyCommand, isReadTool, isWriteTool } from '../src/core/classify.ts';

test('parseDuration accepts compound durations', () => {
  assert.equal(parseDuration('30d'), 30 * 86_400_000);
  assert.equal(parseDuration('12h'), 12 * 3_600_000);
  assert.equal(parseDuration('7d12h'), 7 * 86_400_000 + 12 * 3_600_000);
  assert.equal(parseDuration('90m'), 90 * 60_000);
  assert.equal(parseDuration('45s'), 45_000);
});

test('parseDuration rejects garbage', () => {
  assert.equal(parseDuration(''), undefined);
  assert.equal(parseDuration('abc'), undefined);
  assert.equal(parseDuration('30x'), undefined);
  assert.equal(parseDuration('30d trailing'), undefined);
  assert.equal(parseDuration('-5d'), undefined);
});

test('fingerprint is key-order independent', () => {
  assert.equal(fingerprint({ a: 1, b: { x: 2, y: 3 } }), fingerprint({ b: { y: 3, x: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(fingerprint(null), fingerprint(null));
});

test('fingerprint handles hostile __proto__ keys without prototype mutation', () => {
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<string, unknown>;
  const fp = fingerprint(hostile);
  assert.match(fp, /^[0-9a-f]{64}$/);
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  // Same content, different key order → same fingerprint.
  const hostile2 = JSON.parse('{"a": 1, "__proto__": {"polluted": true}}') as Record<string, unknown>;
  assert.equal(fingerprint(hostile2), fp);
});

test('redactSecrets removes common credential shapes', () => {
  const text = 'key sk-abcdef1234567890abcdef and ghp_123456789012345678901234567890123456 done';
  const out = redactSecrets(text);
  assert.ok(!out.includes('sk-abcdef1234567890abcdef'));
  assert.ok(!out.includes('ghp_123456789012345678901234567890123456'));
  assert.ok(out.includes('[REDACTED]'));
});

test('sanitizeErrorMessage truncates, flattens, redacts', () => {
  const long = 'word '.repeat(200);
  const out = sanitizeErrorMessage(long);
  assert.ok(out);
  assert.ok(out.length <= 201);
  assert.ok(!out.includes('\n'));
  assert.equal(sanitizeErrorMessage(undefined), undefined);
  assert.equal(sanitizeErrorMessage(42), undefined);
  assert.equal(sanitizeErrorMessage(''), undefined);
  const withKey = sanitizeErrorMessage('failed with api_key=sk-verysecretvalue123456');
  assert.ok(withKey);
  assert.ok(!withKey.includes('sk-verysecretvalue123456'));
});

test('isSecretKey matches secret-looking keys only', () => {
  assert.ok(isSecretKey('apiKey'));
  assert.ok(isSecretKey('api_key'));
  assert.ok(isSecretKey('access_token'));
  assert.ok(isSecretKey('password'));
  assert.ok(!isSecretKey('model'));
  assert.ok(!isSecretKey('theme'));
});

test('formatTokens scales', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1500), '1.5k');
  assert.equal(formatTokens(2_500_000), '2.50M');
});

test('classifyCommand detects test runners across ecosystems', () => {
  for (const cmd of ['npm test', 'npm run test', 'pytest -x', 'go test ./...', 'cargo test', 'node --test test/', 'npx vitest run', 'python -m pytest', 'make test', 'yarn test', 'bun test', 'cd app && npm test']) {
    assert.equal(classifyCommand(cmd), 'test', cmd);
  }
});

test('classifyCommand distinguishes non-test categories', () => {
  assert.equal(classifyCommand('npm run build'), 'build');
  assert.equal(classifyCommand('npm install'), 'install');
  assert.equal(classifyCommand('git status'), 'git');
  assert.equal(classifyCommand('grep -n foo bar.ts'), 'search');
  assert.equal(classifyCommand('node server.js'), 'run');
  assert.equal(classifyCommand('echo hello'), 'other');
  // "latest" must not false-positive as test
  assert.notEqual(classifyCommand('npm install latest-dep'), 'test');
});

test('tool classification sets', () => {
  assert.ok(isWriteTool('edit'));
  assert.ok(isWriteTool('apply_patch'));
  assert.ok(isWriteTool('write'));
  assert.ok(!isWriteTool('read'));
  assert.ok(isReadTool('read'));
  assert.ok(!isReadTool('grep'));
});
