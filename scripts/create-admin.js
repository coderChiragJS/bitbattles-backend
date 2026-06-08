/**
 * Create (or promote) an admin user. Used to bootstrap the first admin so the
 * admin panel has something to log in with — there's no public admin signup.
 *
 * Usage:
 *   node scripts/create-admin.js --mobile 9990001111 --password 'Str0ngPass!' --name 'Ops Admin'
 *
 * Idempotent-ish: if the mobile already exists, it's promoted to admin and
 * (optionally) its password is reset to the one provided.
 */
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../src/db/client.js';
import { TABLE } from '../src/db/tables.js';
import { usersRepo } from '../src/modules/auth/repo.js';
import { newUserId } from '../src/utils/ids.js';
import { hashPassword } from '../src/utils/password.js';

function arg(flag, fallbackEnv) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallbackEnv ? process.env[fallbackEnv] : undefined;
}

async function main() {
  const mobile = arg('--mobile', 'ADMIN_BOOTSTRAP_MOBILE');
  const password = arg('--password', 'ADMIN_BOOTSTRAP_PASSWORD');
  const fullName = arg('--name') ?? 'Admin';
  const email = arg('--email');

  if (!mobile || !password) {
    console.error('Usage: node scripts/create-admin.js --mobile <m> --password <p> [--name <n>] [--email <e>]');
    console.error('(or set ADMIN_BOOTSTRAP_MOBILE / ADMIN_BOOTSTRAP_PASSWORD)');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await usersRepo.findByMobile(mobile);
  const user = {
    userId: existing?.userId ?? newUserId(),
    mobile,
    fullName: existing?.fullName ?? fullName,
    email: email ?? existing?.email,
    role: 'admin',
    passwordHash: await hashPassword(password),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };

  await ddb.send(new PutCommand({ TableName: TABLE.users, Item: user }));
  console.log(`${existing ? 'Promoted' : 'Created'} admin ${user.userId} (mobile=${mobile}).`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
