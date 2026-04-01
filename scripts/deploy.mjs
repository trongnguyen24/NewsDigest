import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const envPath = path.join(root, '.env');

function fail(message) {
  console.error(`\n[deploy] ${message}`);
  process.exit(1);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    fail('Khong tim thay .env. Hay copy tu .env.example roi dien thong tin.');
  }

  const text = fs.readFileSync(filePath, 'utf8');
  const out = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }

  return out;
}

function run(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: options.cwd ?? root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(options.env ?? {}) },
    input: options.input,
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }

  return `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
}

function parseWorkerUrl(output) {
  const match = output.match(/https:\/\/[^\s]*workers\.dev/gi);
  return match ? match[0] : '';
}

const env = loadEnv(envPath);
for (const key of ['WORKER_NAME', 'PAGES_PROJECT_NAME']) {
  if (!env[key]) fail(`Thieu bien trong .env: ${key}`);
}

console.log('[deploy] Deploying worker...');
const workerOutput = run('npx', ['wrangler', 'deploy']);

const detectedWorkerUrl = parseWorkerUrl(workerOutput);
const apiUrl = env.WORKER_PUBLIC_URL || detectedWorkerUrl;
if (!apiUrl) {
  fail('Khong lay duoc Worker URL tu output deploy. Hay set WORKER_PUBLIC_URL trong .env.');
}

console.log(`[deploy] API URL for FE: ${apiUrl}`);

console.log('[deploy] Building frontend...');
run('npm', ['run', 'build'], {
  cwd: path.join(root, 'fe'),
  env: { VITE_API_URL: apiUrl },
});

console.log('[deploy] Setting Pages secret API_URL...');
run('npx', ['wrangler', 'pages', 'secret', 'put', 'API_URL', '--project-name', env.PAGES_PROJECT_NAME], {
  input: `${apiUrl}\n`,
});

console.log('[deploy] Deploying frontend to Pages...');
run('npx', [
  'wrangler',
  'pages',
  'deploy',
  'fe/.svelte-kit/cloudflare',
  '--project-name',
  env.PAGES_PROJECT_NAME,
  '--commit-dirty=true',
]);

console.log('\n[deploy] Done.');
