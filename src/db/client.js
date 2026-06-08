/**
 * DynamoDB Document client singleton. The Document client lets us work with
 * plain JS objects instead of the low-level attribute-value format.
 * Honours DYNAMO_ENDPOINT for local development (DynamoDB Local / LocalStack).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { env } from '../config/env.js';

const base = new DynamoDBClient({
  region: env.AWS_REGION,
  ...(env.DYNAMO_ENDPOINT
    ? {
        endpoint: env.DYNAMO_ENDPOINT,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
        },
      }
    : {}),
});

export const ddb = DynamoDBDocumentClient.from(base, {
  marshallOptions: { removeUndefinedValues: true },
});
