/**
 * Idempotent DynamoDB schema for the BitBattles backend.
 *
 * Usage:
 *   node scripts/create-tables.js          # create any missing tables
 *   node scripts/create-tables.js --delete # delete all tables (dev only)
 *
 * Reads AWS_REGION, DYNAMO_TABLE_PREFIX, optional DYNAMO_ENDPOINT from .env.
 * See PLAN.md §4 for the canonical schema reference.
 */

import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from '@aws-sdk/client-dynamodb';
import 'dotenv/config';

const REGION   = process.env.AWS_REGION ?? 'ap-south-1';
const PREFIX   = process.env.DYNAMO_TABLE_PREFIX ?? 'bb_dev_';
const ENDPOINT = process.env.DYNAMO_ENDPOINT;

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT
    ? {
        endpoint: ENDPOINT,
        credentials: {
          accessKeyId:     process.env.AWS_ACCESS_KEY_ID     ?? 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
        },
      }
    : {}),
});

// --- Schema definitions -----------------------------------------------------
// Attribute types: S = string, N = number, B = binary.
// Only attributes that appear in a key or GSI need to be declared.
// All other fields are schemaless and written at runtime.

const TABLES = [
  {
    /**
     * Users — customers and admins.
     * Mobile is unique; enforced by checking the byMobile GSI before insert.
     * Role drives auth gating: 'customer' (default) or 'admin'.
     */
    name: 'users',
    keySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
    attributes: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'mobile', AttributeType: 'S' },
    ],
    gsis: [
      {
        IndexName: 'byMobile',
        KeySchema: [{ AttributeName: 'mobile', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  {
    /**
     * Services — the catalog. Tiny table (~10 rows), scanned on read.
     * Soft-delete via `active=false`.
     */
    name: 'services',
    keySchema: [{ AttributeName: 'serviceId', KeyType: 'HASH' }],
    attributes: [
      { AttributeName: 'serviceId', AttributeType: 'S' },
    ],
    gsis: [],
  },

  {
    /**
     * Providers — security firms, individuals, or small groups.
     * byStatus GSI powers admin filtering (active / onboarding / suspended).
     * Service-membership filtering (`services` list) is done client-side after fetch.
     */
    name: 'providers',
    keySchema: [{ AttributeName: 'providerId', KeyType: 'HASH' }],
    attributes: [
      { AttributeName: 'providerId', AttributeType: 'S' },
      { AttributeName: 'status',     AttributeType: 'S' },
    ],
    gsis: [
      {
        IndexName: 'byStatus',
        KeySchema: [{ AttributeName: 'status', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  {
    /**
     * Bookings — every customer order.
     * Three GSIs cover the three primary access patterns:
     *   - byCustomer:  customer's history (most recent first)
     *   - byProvider:  provider workload (most recent first)
     *   - byStatus:    admin Live Ops feed (most recent first)
     * All sorted by requestedAt (ISO string sorts chronologically).
     */
    name: 'bookings',
    keySchema: [{ AttributeName: 'bookingId', KeyType: 'HASH' }],
    attributes: [
      { AttributeName: 'bookingId',   AttributeType: 'S' },
      { AttributeName: 'customerId',  AttributeType: 'S' },
      { AttributeName: 'providerId',  AttributeType: 'S' },
      { AttributeName: 'status',      AttributeType: 'S' },
      { AttributeName: 'requestedAt', AttributeType: 'S' },
    ],
    gsis: [
      {
        IndexName: 'byCustomer',
        KeySchema: [
          { AttributeName: 'customerId',  KeyType: 'HASH'  },
          { AttributeName: 'requestedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'byProvider',
        KeySchema: [
          { AttributeName: 'providerId',  KeyType: 'HASH'  },
          { AttributeName: 'requestedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'byStatus',
        KeySchema: [
          { AttributeName: 'status',      KeyType: 'HASH'  },
          { AttributeName: 'requestedAt', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  {
    /**
     * Guards — individuals working under a provider.
     * Live location updates land here via PUT /guards/:id/location.
     * byProvider GSI lists a provider's roster.
     */
    name: 'guards',
    keySchema: [{ AttributeName: 'guardId', KeyType: 'HASH' }],
    attributes: [
      { AttributeName: 'guardId',    AttributeType: 'S' },
      { AttributeName: 'providerId', AttributeType: 'S' },
    ],
    gsis: [
      {
        IndexName: 'byProvider',
        KeySchema: [{ AttributeName: 'providerId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

// --- Runners ---------------------------------------------------------------

function tableNameOf(entry) {
  return `${PREFIX}${entry.name}`;
}

async function exists(name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) return false;
    throw err;
  }
}

async function createTable(entry) {
  const TableName = tableNameOf(entry);
  if (await exists(TableName)) {
    console.log(`  · ${TableName} — already exists, skipping`);
    return;
  }

  const command = new CreateTableCommand({
    TableName,
    KeySchema:            entry.keySchema,
    AttributeDefinitions: entry.attributes,
    BillingMode:          'PAY_PER_REQUEST',
    ...(entry.gsis.length > 0 && {
      GlobalSecondaryIndexes: entry.gsis.map((gsi) => ({
        IndexName:  gsi.IndexName,
        KeySchema:  gsi.KeySchema,
        Projection: gsi.Projection,
      })),
    }),
  });

  await client.send(command);
  await waitUntilTableExists({ client, maxWaitTime: 60 }, { TableName });
  console.log(`  + ${TableName} — created (GSIs: ${entry.gsis.length})`);
}

async function deleteTable(entry) {
  const TableName = tableNameOf(entry);
  if (!(await exists(TableName))) {
    console.log(`  · ${TableName} — does not exist, skipping`);
    return;
  }
  await client.send(new DeleteTableCommand({ TableName }));
  await waitUntilTableNotExists({ client, maxWaitTime: 60 }, { TableName });
  console.log(`  - ${TableName} — deleted`);
}

async function main() {
  const mode = process.argv.includes('--delete') ? 'delete' : 'create';
  const target = ENDPOINT ?? `AWS ${REGION}`;
  console.log(`DynamoDB ${mode} — prefix="${PREFIX}" target=${target}`);

  // Sanity: list once so credential / endpoint errors surface early.
  await client.send(new ListTablesCommand({ Limit: 1 }));

  for (const entry of TABLES) {
    if (mode === 'delete') await deleteTable(entry);
    else                   await createTable(entry);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  if (err.$metadata) console.error('  requestId:', err.$metadata.requestId);
  process.exit(1);
});
