import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { scanEnvironment } from '../src/env/environment.ts';
import { tempDir, cleanup, withEnv } from './helpers.ts';

function setup() {
  const dir = tempDir();
  const home = path.join(dir, 'home');
  const ocConfig = path.join(home, '.config', 'opencode');
  const codexHome = path.join(home, '.codex');
  const project = path.join(dir, 'project');
  fs.mkdirSync(ocConfig, { recursive: true });
  fs.mkdirSync(codexHome, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  return { dir, home, ocConfig, codexHome, project };
}


function envFor(s: ReturnType<typeof setup>): Record<string, string | undefined> {
  return {
    CALIPER_OPENCODE_CONFIG_DIR: s.ocConfig,
    CALIPER_CODEX_HOME: s.codexHome,
    CALIPER_CLAUDE_HOME: path.join(s.dir, 'no-claude'),
    CODEX_HOME: undefined,
    CLAUDE_CONFIG_DIR: undefined,
    HOME: s.home,
    USERPROFILE: s.home,
    XDG_CONFIG_HOME: path.join(s.home, '.config'),
  };
}

test('environment: MCP servers discovered from both agents, names only', () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.ocConfig, 'opencode.json'),
    JSON.stringify({
      mcp: { servers: { playwright: { type: 'local', command: ['npx', 'secret-cmd'], environment: { API_KEY: 'sk-supersecret123456' } }, disabled: { enabled: false } } },
    }),
  );
  fs.writeFileSync(path.join(s.codexHome, 'config.toml'), '[mcp_servers.github]\ncommand = "gh-mcp"\nenv = { TOKEN = "ghp_secretsecretsecretsecret1234" }\n');
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    const oc = info.mcpServers.find((m) => m.agent === 'opencode');
    const cx = info.mcpServers.find((m) => m.agent === 'codex');
    assert.deepEqual(oc?.names, ['disabled', 'playwright']);
    assert.deepEqual(cx?.names, ['github']);
    const serialized = JSON.stringify(info);
    assert.ok(!serialized.includes('sk-supersecret123456'));
    assert.ok(!serialized.includes('ghp_secretsecretsecretsecret1234'));
    assert.ok(!serialized.includes('secret-cmd'));
  });
  cleanup(s.dir);
});

test('environment: plaintext secrets flagged, env references not flagged', () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.ocConfig, 'opencode.json'),
    JSON.stringify({
      provider: {
        good: { options: { apiKey: '{env:GOOD_KEY}' } },
        bad: { options: { apiKey: 'sk-literal-secret-value-123' } },
      },
    }),
  );
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    assert.equal(info.secretExposures.length, 1);
    assert.equal(info.secretExposures[0]?.keyPath, 'provider.bad.options.apiKey');
    assert.ok(!JSON.stringify(info).includes('sk-literal-secret-value-123'));
  });
  cleanup(s.dir);
});

test('environment: malformed config produces warning, not crash', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.ocConfig, 'opencode.json'), '{broken');
  fs.writeFileSync(path.join(s.codexHome, 'config.toml'), 'this is = not [ valid toml');
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    assert.ok(info.warnings.length >= 1);
    assert.equal(info.mcpServers.length, 0);
  });
  cleanup(s.dir);
});

test('environment: skill dirs and collisions discovered', () => {
  const s = setup();
  fs.mkdirSync(path.join(s.ocConfig, 'skills', 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(s.codexHome, 'skills', 'deploy'), { recursive: true });
  fs.mkdirSync(path.join(s.codexHome, 'skills', 'unique'), { recursive: true });
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    const all = info.skills.flatMap((g) => g.ids);
    assert.ok(all.includes('deploy'));
    assert.ok(all.includes('unique'));
    assert.equal(info.skills.length, 2);
  });
  cleanup(s.dir);
});

test('environment: instruction files hashed, content never stored', () => {
  const s = setup();
  fs.writeFileSync(path.join(s.project, 'AGENTS.md'), 'SECRET INSTRUCTION CONTENT do not leak');
  fs.writeFileSync(path.join(s.ocConfig, 'AGENTS.md'), 'global instructions');
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    assert.equal(info.instructionFiles.length, 2);
    for (const f of info.instructionFiles) {
      assert.ok(f.sha256.length === 64);
      assert.ok(f.bytes > 0);
    }
    assert.ok(!JSON.stringify(info).includes('SECRET INSTRUCTION CONTENT'));
  });
  cleanup(s.dir);
});

test('environment: config-declared skill paths are honored', () => {
  const s = setup();
  const extra = path.join(s.dir, 'extra-skills');
  fs.mkdirSync(path.join(extra, 'custom-skill'), { recursive: true });
  fs.writeFileSync(path.join(s.ocConfig, 'opencode.json'), JSON.stringify({ skills: [extra] }));
  withEnv(envFor(s), () => {
    const info = scanEnvironment({ projectDir: s.project });
    assert.ok(info.skills.some((g) => g.dir === extra && g.ids.includes('custom-skill')));
  });
  cleanup(s.dir);
});
