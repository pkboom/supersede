#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const DB_PATH = './data/dev.db';
const ENV_PATH = './.env';
const MIN_NODE_MAJOR = 20;

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  console.error(`[setup] Node ${MIN_NODE_MAJOR}+ required (found v${process.versions.node}).`);
  process.exit(1);
}

const rl = createInterface({ input: stdin, output: stdout });
async function ask(prompt, def) {
  const suffix = def ? ` [${def}]` : '';
  const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
  return answer || def || '';
}

function run(label, cmd, env = {}) {
  stdout.write(`\n[setup] ${label}\n`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
}

try {
  // 1) Dependencies must land before we import better-sqlite3.
  run('Installing dependencies (npm install)', 'npm install');

  stdout.write('\n[setup] Creating ./data/ directory\n');
  mkdirSync('./data', { recursive: true });

  run(
    `Applying database migrations (EMAIL_DESIGNER_DB_PATH=${DB_PATH})`,
    'npm run db:migrate',
    { EMAIL_DESIGNER_DB_PATH: DB_PATH },
  );

  // 2) Better-sqlite3 is now installed; defer the import so a missing
  //    dependency doesn't crash before `npm install` runs.
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  const currentRow = db.prepare('SELECT default_mode FROM settings WHERE id = 1').get();
  const currentMode = currentRow?.default_mode ?? 'cli';

  // 3) Pick mode.
  stdout.write(`\n[setup] Pick how the server should reach Claude.\n`);
  stdout.write(`  1) Claude CLI — server shells out to the local 'claude' binary (default)\n`);
  stdout.write(`  2) API key   — server reads ANTHROPIC_API_KEY (written to .env)\n`);
  const defaultChoice = currentMode === 'api' ? '2' : '1';
  let mode = currentMode;
  while (true) {
    const choice = (await ask('Choose [1/2]', defaultChoice)).toLowerCase();
    if (choice === '1' || choice === 'cli') { mode = 'cli'; break; }
    if (choice === '2' || choice === 'api') { mode = 'api'; break; }
    stdout.write(`  Please answer 1 or 2.\n`);
  }

  // 4) Verify the chosen mode is actually ready.
  if (mode === 'api') {
    let key = readEnvKey();
    if (!key && process.env.ANTHROPIC_API_KEY) {
      key = process.env.ANTHROPIC_API_KEY;
      writeEnvKey(key);
      stdout.write(`[setup] Mirrored ANTHROPIC_API_KEY from shell env to ${ENV_PATH}\n`);
    }
    if (!key) {
      stdout.write(`\n[setup] No ANTHROPIC_API_KEY found in env or ${ENV_PATH}.\n`);
      const entered = (await ask('Paste your Anthropic API key (sk-ant-...) or press Enter to skip')).trim();
      if (entered) {
        if (!/^sk-ant-/.test(entered)) {
          stdout.write(`[setup] WARNING: key does not start with "sk-ant-" — proceeding anyway.\n`);
        }
        writeEnvKey(entered);
        key = entered;
        stdout.write(`[setup] Wrote ANTHROPIC_API_KEY to ${ENV_PATH}\n`);
      } else {
        stdout.write(`[setup] Skipped. /query will return 412 until you add the key:\n`);
        stdout.write(`        echo 'ANTHROPIC_API_KEY=sk-ant-...' >> ${ENV_PATH}\n`);
      }
    } else {
      stdout.write(`[setup] ANTHROPIC_API_KEY already present in ${ENV_PATH} (${maskKey(key)})\n`);
    }
  } else {
    // mode === 'cli' — probe the binary.
    const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' });
    if (probe.error || probe.status !== 0) {
      stdout.write(`\n[setup] WARNING: 'claude' binary not found on PATH.\n`);
      stdout.write(`  Install Claude Code: https://claude.com/claude-code\n`);
      stdout.write(`  Then authenticate:    claude auth login\n`);
      stdout.write(`  /query will fail until both are in place.\n`);
    } else {
      stdout.write(`[setup] Found claude CLI: ${probe.stdout.trim()}\n`);
      stdout.write(`[setup] If you have not done so, run once:  claude auth login\n`);
    }
  }

  // 5) Persist the chosen mode into the singleton settings row.
  const now = Date.now();
  db.prepare(`
    INSERT INTO settings (id, default_provider, default_mode, default_model, updated_at)
    VALUES (1, 'anthropic', ?, 'claude-opus-4-7', ?)
    ON CONFLICT(id) DO UPDATE
      SET default_mode = excluded.default_mode,
          updated_at = excluded.updated_at
  `).run(mode, now);
  db.close();

  stdout.write(`\n[setup] Done. Mode = ${mode}.\n\n`);
  stdout.write(
    'Start the app:\n' +
      '  npm run dev    # http://localhost:5173\n',
  );
  if (mode === 'api') {
    stdout.write(`\nNote: the dev/start scripts auto-load ${ENV_PATH} at boot.\n`);
  }
} finally {
  rl.close();
}

function readEnvKey() {
  if (!existsSync(ENV_PATH)) return null;
  const lines = readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const m = /^\s*ANTHROPIC_API_KEY\s*=\s*(.*)$/.exec(line);
    if (m) return stripQuotes(m[1].trim());
  }
  return null;
}

function writeEnvKey(value) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split('\n') : [];
  let found = false;
  const next = lines.map((line) => {
    if (/^\s*ANTHROPIC_API_KEY\s*=/.test(line)) {
      found = true;
      return `ANTHROPIC_API_KEY=${value}`;
    }
    return line;
  });
  if (!found) next.push(`ANTHROPIC_API_KEY=${value}`);
  while (next.length && next[next.length - 1] === '') next.pop();
  writeFileSync(ENV_PATH, next.join('\n') + '\n', { mode: 0o600 });
}

function stripQuotes(s) {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function maskKey(k) {
  if (k.length < 12) return '****';
  return `${k.slice(0, 8)}…${k.slice(-4)}`;
}
