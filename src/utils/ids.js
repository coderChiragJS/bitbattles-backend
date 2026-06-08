/**
 * ID helpers. ULIDs are lexicographically sortable (time-ordered) and
 * collision-resistant — good DynamoDB partition keys.
 */
import { ulid } from 'ulid';

export const newUserId = () => `usr_${ulid()}`;
