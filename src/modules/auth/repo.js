/**
 * Users persistence — the only auth file that talks to DynamoDB.
 * The service layer depends on this interface, so tests can swap in a fake.
 */
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../../db/client.js';
import { TABLE, INDEX } from '../../db/tables.js';

export const usersRepo = {
  /** Look up a single user by mobile via the byMobile GSI (null if none). */
  async findByMobile(mobile) {
    const out = await ddb.send(
      new QueryCommand({
        TableName: TABLE.users,
        IndexName: INDEX.users.byMobile,
        KeyConditionExpression: 'mobile = :m',
        ExpressionAttributeValues: { ':m': mobile },
        Limit: 1,
      }),
    );
    return out.Items?.[0] ?? null;
  },

  async findById(userId) {
    const out = await ddb.send(
      new GetCommand({ TableName: TABLE.users, Key: { userId } }),
    );
    return out.Item ?? null;
  },

  /** Insert a user, guarding against a userId collision. */
  async create(user) {
    await ddb.send(
      new PutCommand({
        TableName: TABLE.users,
        Item: user,
        ConditionExpression: 'attribute_not_exists(userId)',
      }),
    );
    return user;
  },
};
