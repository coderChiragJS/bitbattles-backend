/**
 * Table-name helpers. Names are prefixed per environment (e.g. bb_dev_users)
 * so multiple stages can share one AWS account. Keep these in sync with
 * scripts/create-tables.js (the prefix comes from the same env var).
 */
import { env } from '../config/env.js';

const prefix = env.DYNAMO_TABLE_PREFIX;

export const TABLE = {
  users: `${prefix}users`,
  services: `${prefix}services`,
  providers: `${prefix}providers`,
  bookings: `${prefix}bookings`,
  guards: `${prefix}guards`,
};

export const INDEX = {
  users: { byMobile: 'byMobile' },
  providers: { byStatus: 'byStatus' },
  bookings: { byCustomer: 'byCustomer', byProvider: 'byProvider', byStatus: 'byStatus' },
  guards: { byProvider: 'byProvider' },
};
