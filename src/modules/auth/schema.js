/**
 * Request schemas for the auth module. Kept lenient on mobile format because
 * the two clients differ (mobile app: 10 digits, admin: free-form/E.164) —
 * we normalise by trimming and treat the stored value as the unique key.
 */
import { z } from 'zod';

const mobile = z.string().trim().min(5, 'Mobile number is too short').max(20);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const signupSchema = {
  body: z.object({
    fullName: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.string().trim().email('Enter a valid email').max(120).optional(),
    mobile,
    password,
  }),
};

export const loginSchema = {
  body: z.object({ mobile, password }),
};
