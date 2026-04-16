import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const envPath = path.join(root, '.env');
const wranglerPath = path.join(root, 'wrangler.toml');

function fail(message) {
  console.error(`\n[cf:init] ${message}`);
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
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    input: options.input,
    env: { ...process.env, ...options.env },
  });

  if (res.status !== 0) {
    if (res.stdout) process.stdout.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
    throw new Error(`${cmd} ${args.join(' ')} failed`);
  }

  return res.stdout ?? '';
}

function tryRun(cmd, args, options = {}) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    input: options.input,
    env: { ...process.env, ...options.env },
  });

  return res;
}

function ensureRequired(env, keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length > 0) {
    fail(`Thieu bien trong .env: ${missing.join(', ')}`);
  }
}

function buildBaseWranglerToml(env) {
  return `# managed-by-cf-init
name = "${env.WORKER_NAME}"
main = "worker/index.ts"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[triggers]
crons = ["0 */3 * * *", "0 1 * * *"]

[[queues.producers]]
queue = "${env.QUEUE_NAME}"
binding = "CONTENT_QUEUE"

[[queues.consumers]]
queue = "${env.QUEUE_NAME}"
max_batch_size = 1
max_batch_timeout = 5
max_retries = 3
dead_letter_queue = "${env.QUEUE_DLQ_NAME}"
`;
}

function upsertSecret(key, value) {
  if (!value) return;
  console.log(`[cf:init] Setting worker secret: ${key}`);
  run('npx', ['wrangler', 'secret', 'put', key], { input: `${value}\n` });
}

function upsertPagesSecret(projectName, key, value) {
  if (!value) return;
  console.log(`[cf:init] Setting pages secret: ${key}`);
  run('npx', ['wrangler', 'pages', 'secret', 'put', key, '--project-name', projectName], { input: `${value}\n` });
}

const env = loadEnv(envPath);

ensureRequired(env, [
  'WORKER_NAME',
  'PAGES_PROJECT_NAME',
  'D1_DATABASE_NAME',
  'KV_SCRAPER_CONFIG_NAME',
  'QUEUE_NAME',
  'QUEUE_DLQ_NAME',
  'AI_GATEWAY_URL',
  'AI_GATEWAY_TOKEN',
  'RAPIDAPI_KEY',
]);

console.log('[cf:init] Checking Cloudflare login...');
try {
  run('npx', ['wrangler', 'whoami'], { stdio: 'pipe' });
} catch {
  fail('Ban chua login Cloudflare. Hay chay: npx wrangler login');
}

const currentWrangler = fs.existsSync(wranglerPath) ? fs.readFileSync(wranglerPath, 'utf8') : '';
const hasMarker = currentWrangler.includes('# managed-by-cf-init');
const hasD1Binding = currentWrangler.includes('binding = "DB"');
const hasScraperKvBinding = currentWrangler.includes('binding = "SCRAPER_CONFIG"');

if (!hasMarker || (!hasD1Binding && !hasScraperKvBinding)) {
  console.log('[cf:init] Writing base wrangler.toml...');
  fs.writeFileSync(wranglerPath, buildBaseWranglerToml(env), 'utf8');
}

let wranglerNow = fs.readFileSync(wranglerPath, 'utf8');

if (!wranglerNow.includes('binding = "DB"')) {
  console.log('[cf:init] Creating D1 database and binding DB...');
  run('npx', [
    'wrangler',
    'd1',
    'create',
    env.D1_DATABASE_NAME,
    '--binding',
    'DB',
    '--update-config',
  ]);
}

wranglerNow = fs.readFileSync(wranglerPath, 'utf8');
if (!wranglerNow.includes('binding = "SCRAPER_CONFIG"')) {
  console.log('[cf:init] Creating KV namespace and binding SCRAPER_CONFIG...');
  run('npx', [
    'wrangler',
    'kv',
    'namespace',
    'create',
    env.KV_SCRAPER_CONFIG_NAME,
    '--binding',
    'SCRAPER_CONFIG',
    '--update-config',
  ]);
}



console.log('[cf:init] Ensuring queues exist...');
for (const q of [env.QUEUE_NAME, env.QUEUE_DLQ_NAME]) {
  const createQueue = tryRun('npx', ['wrangler', 'queues', 'create', q], { stdio: 'pipe' });
  const output = `${createQueue.stdout ?? ''}\n${createQueue.stderr ?? ''}`;
  if (createQueue.status === 0) {
    console.log(`[cf:init] Queue ready: ${q}`);
    continue;
  }
  if (/already exists/i.test(output)) {
    console.log(`[cf:init] Queue already exists: ${q}`);
    continue;
  }
  process.stdout.write(createQueue.stdout ?? '');
  process.stderr.write(createQueue.stderr ?? '');
  fail(`Khong the tao queue: ${q}`);
}

console.log('[cf:init] Ensuring Pages project exists...');
const projectCreate = tryRun(
  'npx',
  ['wrangler', 'pages', 'project', 'create', env.PAGES_PROJECT_NAME],
  { stdio: 'pipe' },
);
if (projectCreate.status === 0) {
  console.log(`[cf:init] Pages project created: ${env.PAGES_PROJECT_NAME}`);
} else {
  const output = `${projectCreate.stdout ?? ''}\n${projectCreate.stderr ?? ''}`;
  if (/already exists|A project with this name already exists/i.test(output)) {
    console.log(`[cf:init] Pages project already exists: ${env.PAGES_PROJECT_NAME}`);
  } else {
    process.stdout.write(projectCreate.stdout ?? '');
    process.stderr.write(projectCreate.stderr ?? '');
    fail('Khong the tao Pages project');
  }
}

console.log('[cf:init] Setting worker secrets from .env...');
upsertSecret('AI_GATEWAY_URL', env.AI_GATEWAY_URL);
upsertSecret('AI_GATEWAY_TOKEN', env.AI_GATEWAY_TOKEN);
upsertSecret('RAPIDAPI_KEY', env.RAPIDAPI_KEY);

if (env.ADMIN_API_KEY) upsertSecret('ADMIN_API_KEY', env.ADMIN_API_KEY);
if (env.YOUTUBE_API_KEY) upsertSecret('YOUTUBE_API_KEY', env.YOUTUBE_API_KEY);

if (env.WORKER_PUBLIC_URL) {
  upsertPagesSecret(env.PAGES_PROJECT_NAME, 'API_URL', env.WORKER_PUBLIC_URL);
}

console.log('[cf:init] Running D1 migration...');
run('npx', ['wrangler', 'd1', 'execute', env.D1_DATABASE_NAME, '--remote', '--file=schema.sql'], { stdio: 'inherit' });

console.log('\n[cf:init] Done. Ban co the deploy bang: npm run deploy');
