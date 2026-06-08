/**
 * One-command local dev. Starts DynamoDB Local, ensures the tables exist, then
 * runs the backend with --watch. Ctrl+C tears everything down together.
 *
 *   npm run dev
 *
 * DynamoDB Local is downloaded once into backend/.dynamodb-local/ (gitignored)
 * and run in persistent mode (-dbPath), so your data survives restarts.
 * Requires Java (the only external dependency). If DynamoDB Local is already
 * running on the port, this reuses it instead of starting a second copy.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, '..');
const vendor = join(backend, '.dynamodb-local');
const jar = join(vendor, 'DynamoDBLocal.jar');
const lib = join(vendor, 'DynamoDBLocal_lib');
const dataDir = join(vendor, 'data');

const DDB_PORT = Number(process.env.DDB_LOCAL_PORT ?? 8000);
const TARBALL = 'https://d1ni2b6xgvw0s0.cloudfront.net/dynamodb_local_latest.tar.gz';

// Local-dev env defaults. A real .env still wins (we only fill what's missing),
// so this works without anyone having to edit .env first.
const env = {
  ...process.env,
  DYNAMO_ENDPOINT: process.env.DYNAMO_ENDPOINT ?? `http://localhost:${DDB_PORT}`,
  DYNAMO_TABLE_PREFIX: process.env.DYNAMO_TABLE_PREFIX ?? 'bb_dev_',
  AWS_REGION: process.env.AWS_REGION ?? 'ap-south-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID ?? 'local',
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-insecure-secret-change-me-now',
};

const children = [];
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp(port) {
  try {
    await fetch(`http://localhost:${port}`); // any response (even 400) means it's listening
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(fn, { tries = 60, gap = 250 } = {}) {
  for (let i = 0; i < tries; i++) {
    if (await fn()) return true;
    await sleep(gap);
  }
  return false;
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✗ command failed: ${cmd} ${args.join(' ')}`);
    shutdown(1);
  }
}

function ensureDownloaded() {
  if (existsSync(jar)) return;
  console.log('· downloading DynamoDB Local (first run only)…');
  mkdirSync(vendor, { recursive: true });
  const tgz = join(vendor, 'ddb.tar.gz');
  sh('curl', ['-sSL', TARBALL, '-o', tgz]);
  sh('tar', ['xzf', tgz, '-C', vendor]);
}

async function main() {
  // 1) DynamoDB Local — reuse if already up, otherwise start it.
  if (await isUp(DDB_PORT)) {
    console.log(`· DynamoDB Local already on :${DDB_PORT} — reusing`);
  } else {
    ensureDownloaded();
    mkdirSync(dataDir, { recursive: true });
    console.log(`· starting DynamoDB Local on :${DDB_PORT} (persistent: .dynamodb-local/data)`);
    const ddb = spawn(
      'java',
      [`-Djava.library.path=${lib}`, '-jar', jar, '-dbPath', dataDir, '-sharedDb', '-port', String(DDB_PORT)],
      // Run in the vendor dir so DynamoDB Local's metadata file lands there
      // (gitignored) instead of polluting the backend root.
      { stdio: 'ignore', cwd: vendor },
    );
    ddb.on('error', (e) => {
      console.error(`✗ could not start DynamoDB Local — is Java installed? (${e.message})`);
      shutdown(1);
    });
    children.push(ddb);
    if (!(await waitUntil(() => isUp(DDB_PORT)))) {
      console.error('✗ DynamoDB Local did not become ready in time');
      shutdown(1);
    }
    console.log('· DynamoDB Local ready');
  }

  // 2) Tables — idempotent, safe to run every boot.
  console.log('· ensuring tables…');
  sh('node', [join(backend, 'scripts', 'create-tables.js')], { env });

  // 3) Backend with hot reload.
  console.log(`· starting backend on :${env.PORT ?? 4000}\n`);
  const api = spawn('node', ['--watch', join(backend, 'src', 'server.js')], { stdio: 'inherit', env });
  api.on('exit', (code) => shutdown(code ?? 0));
  children.push(api);
}

main();
