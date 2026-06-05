# BitBattles Backend — Implementation Plan

Single source of truth for the Express + DynamoDB backend that serves the
QuickSec mobile app (`quick_commerce/`) and the admin panel (`ADMIN_PANEL/`).
Built incrementally — each milestone is independently shippable.

---

## 1. Scope & Constraints

- Two clients: React Native (Expo) mobile, React + Vite admin.
- Storage: AWS DynamoDB (single-region to start).
- Runtime: Node.js (Express 4).
- Deployment target: containerised (any of Fly.io / Render / ECS Fargate). Plan stays portable.
- Auth: JWT (access tokens only, ~7-day expiry). Role on the token (`customer` | `admin`). Refresh tokens deferred until needed.
- Hard constraints from `CLAUDE.md`: files < 500 lines, validate at boundaries, no secrets in repo.

Out of scope for v1: payments, push notifications, file uploads, real-time guard tracking (WebSocket). Endpoints will be designed so these can be slotted in later without breaking changes.

---

## 2. Tech Stack

| Concern | Choice | Why |
|--------|--------|------|
| Framework | Express 4 | Smallest surface area, matches the stated architecture |
| DB SDK | `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` | Official v3, Document client for ergonomics |
| Auth | `jsonwebtoken`, `bcryptjs` | Battle-tested, no native build issues |
| Validation | `zod` | Type-safe schemas, single source for request shapes |
| Logging | `pino` + `pino-http` | Structured, low overhead |
| Env | `dotenv` (dev only) | Real envs come from the host |
| Testing | `vitest` + `supertest` | Fast, ESM-native |
| Lint | `eslint` (flat config, matching the other two apps) | Consistency |

Language: **JavaScript (ESM)** to keep the boot story simple. We can layer TypeScript later if it becomes painful. (If you'd prefer TS from day one, say so — both apps already use it.)

---

## 3. Folder Structure

```
backend/
├── PLAN.md                  ← this file
├── package.json
├── .env.example
├── .gitignore
├── eslint.config.js
├── src/
│   ├── server.js            # boot: load env, build app, listen
│   ├── app.js               # express app factory (mountable in tests)
│   ├── config/
│   │   └── env.js           # parsed + validated env (zod)
│   ├── db/
│   │   ├── client.js        # DynamoDBDocumentClient singleton
│   │   └── tables.js        # table-name constants + key helpers
│   ├── middleware/
│   │   ├── auth.js          # requireAuth, requireRole
│   │   ├── error.js         # central error handler
│   │   └── validate.js      # zod → 400 mapper
│   ├── modules/
│   │   ├── auth/            # login/signup
│   │   ├── services/        # service catalog
│   │   ├── providers/
│   │   ├── bookings/
│   │   ├── customers/       # admin only
│   │   ├── guards/          # admin only
│   │   └── metrics/         # admin only
│   └── utils/
│       ├── ids.js           # ULID-based ID helpers
│       └── http.js          # ok(), created(), etc.
├── scripts/
│   ├── create-tables.js     # idempotent table creation (dev/staging)
│   └── seed.js              # seeds Services + Providers from mock files
└── tests/
    └── ...                  # mirrors src/modules/
```

Each module follows the same shape:
```
modules/<name>/
├── routes.js     # express.Router, glues middleware + controller
├── controller.js # request/response, no business logic
├── service.js    # business logic, pure-ish, takes deps
├── repo.js       # DynamoDB queries (only file touching the SDK)
└── schema.js     # zod schemas for request validation
```

---

## 4. DynamoDB Design

Naming: `bb_<env>_<table>` (e.g. `bb_dev_users`). Single-table is *not* used here — five focused tables read more clearly and the data volume doesn't justify the complexity yet.

### 4.1 Users
- **PK**: `userId` (S) — ULID
- Attributes: `mobile`, `passwordHash`, `fullName`, `email?`, `role` (`customer` | `admin`), `createdAt`
- **GSI `byMobile`**: PK `mobile` → for login lookup. Mobile must be unique; enforce via conditional `PutItem` on the GSI key after a probe read.

### 4.2 Services
- **PK**: `serviceId` (S) — e.g. `svc-guard`
- Attributes: `slug`, `name`, `category`, `basePrice`, `etaMinutes`, `active`, `description`, `included` (list), `imageKey?`
- No GSI — read is `Scan` (tiny table, ~10 rows).

### 4.3 Providers
- **PK**: `providerId` (S) — e.g. `PR-3001`
- Attributes: `name`, `type` (`company|individual|group`), `status`, `rating`, `reviewCount`, `experienceYears`, `responseMinutes`, `availability`, `priceMultiplier`, `guardsCount`, `zones` (list), `badges` (list), `services` (list of serviceIds), `photoUrl`, `contactPerson`, `mobile`, `email`, `kyc` (map), `joinedAt`
- **GSI `byStatus`**: PK `status` → admin filtering.
- Service-membership filtering is done client-side after fetch (small N).

### 4.4 Bookings
- **PK**: `bookingId` (S) — e.g. `BK-10031`
- Attributes: `customerId`, `serviceId`, `serviceName` (denormalised for listings), `providerId?`, `providerName?`, `guardId?`, `type` (`instant|scheduled`), `status`, `scheduledFor?`, `requestedAt`, `price`, `durationHrs`, `etaMinutes`, `address` (map: label, full, lat, lng)
- **GSI `byCustomer`**: PK `customerId`, SK `requestedAt` (DESC) — customer's booking history.
- **GSI `byProvider`**: PK `providerId`, SK `requestedAt` — provider workload.
- **GSI `byStatus`**: PK `status`, SK `requestedAt` — admin Live Ops view.

### 4.5 Guards
- **PK**: `guardId` (S) — e.g. `GD-1001`
- Attributes: `providerId`, `name`, `mobile`, `rating`, `status` (`on_duty|available|off_duty`), `location` (map: lat, lng), `zone`, `totalJobs`, `joinedAt`
- **GSI `byProvider`**: PK `providerId`.
- Live location updates handled by `PUT /guards/:id/location` (later: WebSocket).

### 4.6 (Deferred) Metrics
Computed on read by scanning Bookings/Users with date filters for v1. Move to a materialised summary table (or a daily Lambda) once volumes warrant.

---

## 5. Authentication & Authorisation

- **Signup (mobile)**: `POST /auth/signup` → conditional insert into Users keyed by mobile. Hash with `bcrypt` (12 rounds). Returns `{ token, user }` matching `AuthSession` in `quick_commerce/src/features/auth/types.ts`.
- **Login (mobile)**: `POST /auth/login` → lookup by `byMobile` GSI, `bcrypt.compare`, sign JWT.
- **Login (admin)**: `POST /auth/admin/login` — same shape but rejects non-`admin` users.
- **JWT payload**: `{ sub: userId, role, mobile }`. Secret in `JWT_SECRET` env. Algorithm HS256.
- **Middleware `requireAuth`**: parses `Authorization: Bearer <jwt>`, attaches `req.user`.
- **Middleware `requireRole('admin')`**: gate on `req.user.role`.
- First admin is bootstrapped via `scripts/seed.js` (reads `ADMIN_BOOTSTRAP_MOBILE` + `ADMIN_BOOTSTRAP_PASSWORD` envs).

---

## 6. API Surface (v1)

Conventions: JSON in/out, `application/json`, errors as `{ error: { message, code? } }`, success bodies are the resource itself (not wrapped) — matches what `quick_commerce/src/services/api/client.ts` already parses.

### Public
- `GET  /health` → `{ status: 'ok', time }`

### Auth
- `POST /auth/signup` — body `{ fullName, email, mobile, password }` → `{ token, user }`
- `POST /auth/login` — body `{ mobile, password }` → `{ token, user }`
- `POST /auth/admin/login` — body `{ mobile, password }` → `{ token, user }`
- `GET  /auth/me` — auth required → `{ user }`

### Services
- `GET  /services` — public list
- `GET  /services/:id` — public detail
- `POST /admin/services` — admin create
- `PATCH /admin/services/:id` — admin update
- `DELETE /admin/services/:id` — admin (soft delete: `active=false`)

### Providers
- `GET  /providers?serviceId=&zone=&availability=` — public list with filters
- `GET  /providers/:id` — public detail
- `POST /admin/providers` — admin create
- `PATCH /admin/providers/:id` — admin update (status, rating, etc.)

### Bookings
- `POST /bookings` — auth (customer) → create. Body: `{ serviceId, providerId?, type, scheduledFor?, address, durationHrs }`. Server fills `price`, `requestedAt`, `status='pending'`.
- `GET  /bookings/mine` — auth (customer) → customer's bookings via `byCustomer` GSI.
- `GET  /bookings/:id` — auth (customer or admin owning it).
- `PATCH /bookings/:id` — auth (admin only for v1) → status transitions + provider/guard assignment.
- `GET  /admin/bookings?status=&from=&to=` — admin Live Ops feed.

### Customers (admin)
- `GET  /admin/customers`
- `GET  /admin/customers/:id` → includes recent bookings

### Guards (admin)
- `GET  /admin/guards?providerId=&status=`
- `GET  /admin/guards/:id`
- `POST /admin/guards`
- `PATCH /admin/guards/:id`
- `PUT  /admin/guards/:id/location` — body `{ lat, lng }`

### Metrics (admin)
- `GET  /admin/metrics/overview` → `{ totalUsers, activeBookings, signupsLast30Days[] }`

---

## 7. Validation & Error Handling

- Every route declares a `zod` schema in its module's `schema.js`.
- `validate(schema)` middleware parses `req.body` / `req.params` / `req.query`; on failure → 400 with `{ error: { message: '...', code: 'VALIDATION', issues: [...] } }`.
- All errors funnel through `middleware/error.js` which:
  - Maps known errors (`ApiError`, AWS `ConditionalCheckFailedException`, `JsonWebTokenError`) to HTTP codes.
  - Logs via `pino` with `req.id`.
  - Returns generic 500 with `code: 'INTERNAL'` for anything unknown; full details only in logs.

---

## 8. Configuration

`backend/.env.example`:
```
PORT=4000
NODE_ENV=development
LOG_LEVEL=info

# DynamoDB
AWS_REGION=ap-south-1
DYNAMO_TABLE_PREFIX=bb_dev_
# For local dev with DynamoDB Local:
# DYNAMO_ENDPOINT=http://localhost:8000

# Auth
JWT_SECRET=replace-me-with-a-long-random-string
JWT_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# CORS — comma-separated origins
CORS_ORIGINS=http://localhost:5173,http://localhost:8081

# Admin bootstrap (only consulted by scripts/seed.js)
ADMIN_BOOTSTRAP_MOBILE=
ADMIN_BOOTSTRAP_PASSWORD=
```

Mobile gets `EXPO_PUBLIC_API_BASE_URL=http://<host>:4000` and `EXPO_PUBLIC_USE_MOCK_API=false`. Admin gets a `VITE_API_BASE_URL` (currently doesn't exist; we'll wire it up in the admin slice).

---

## 9. Local Development Story

1. `npm install`
2. Start DynamoDB Local (Docker): `docker run -p 8000:8000 amazon/dynamodb-local`. Set `DYNAMO_ENDPOINT=http://localhost:8000`.
3. `node scripts/create-tables.js` — idempotent, creates the five tables + GSIs.
4. `node scripts/seed.js` — seeds Services, Providers, a bootstrap admin.
5. `npm run dev` (nodemon) → server on `:4000`.
6. Mobile: set `EXPO_PUBLIC_API_BASE_URL=http://<lan-ip>:4000` in the Expo shell.

---

## 10. Deployment (sketch)

Smallest viable path:
- Container: `node:20-alpine`, single-stage Dockerfile.
- Host: Fly.io or Render — both give HTTPS + env-var injection + cheap autoscale.
- DynamoDB: real AWS account, IAM user scoped to the five tables (least-privilege policy template in `docs/iam-policy.json` — written when we get there).
- Secrets via host's env config; no `.env` in the container image.

Defer to later (not blockers for v1):
- Custom domain + cert
- CloudWatch alarms
- DynamoDB on-demand → provisioned switch once usage patterns are known

---

## 11. Testing Strategy

- **Unit**: each `service.js` tested with `vitest` against a mocked `repo`.
- **Integration**: `supertest` boots `app.js`, talks to DynamoDB Local. Each test file seeds its own data, cleans up in `afterAll`.
- **CI**: GitHub Actions (deferred — added when the first PR lands).
- Coverage target: 70% for services, controllers can stay thin and untested if pure pass-through.

---

## 12. Milestones (incremental, each shippable)

Per your preference for small steps, this is the order. Each milestone ends with the server still running, tests green, and the client(s) at least partially using it.

**M0 — Skeleton** *(~30 min)*
- `package.json`, `.env.example`, `.gitignore`, `eslint.config.js`
- `src/server.js`, `src/app.js`, `/health` route
- Pino logging, central error handler, validate middleware
- One smoke test (`GET /health` → 200)

**M1 — DynamoDB wiring** *(~30 min)*
- `db/client.js` (with optional `DYNAMO_ENDPOINT` for local)
- `db/tables.js` (name helpers)
- `scripts/create-tables.js` (idempotent)
- Manual verification only

**M2 — Auth (mobile path)** *(~1 h)*
- Users table created
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`
- `requireAuth` middleware
- Mobile app: flip `EXPO_PUBLIC_USE_MOCK_API=false`, end-to-end login works against the new backend.

**M3 — Services + Providers (read-only, public)** *(~1 h)*
- Tables + seed script reading from `quick_commerce/.../mockData.ts` & `ADMIN_PANEL/.../mockProviders.js`
- `GET /services`, `GET /services/:id`, `GET /providers`, `GET /providers/:id`
- Admin & mobile can drop their mock imports for these two resources.

**M4 — Bookings (customer create + read)** *(~1.5 h)*
- Bookings table with all three GSIs
- `POST /bookings`, `GET /bookings/mine`, `GET /bookings/:id`
- Mobile `features/booking/storage.ts` (AsyncStorage) becomes a cache layer in front of the API instead of the source of truth.

**M5 — Admin auth + Live Ops** *(~1 h)*
- `POST /auth/admin/login`, admin bootstrap script
- `GET /admin/bookings`, `PATCH /bookings/:id` (status transitions, assignment)
- Admin panel `LoginPage` calls the real endpoint; `BookingsPage`/`LiveOpsPage` reads from API.

**M6 — Admin: Customers, Guards, Metrics** *(~1.5 h)*
- Remaining admin endpoints
- Admin panel drops the last of its mock files

**M7 — Hardening (before any production deploy)**
- Rate limiting on `/auth/*` (`express-rate-limit`)
- Helmet
- Request ID + structured logs
- Dockerfile + a `fly.toml` or `render.yaml`
- IAM policy doc

Anything beyond M7 (payments, websocket guard tracking, push, file uploads) gets its own plan when it's prioritised.

---

## 13. Open Questions

These don't block M0 but should be settled before the milestones that touch them:

1. **Mobile number format / country**: signup accepts a raw string today (`features/auth/validation.ts`); do we normalise to E.164 server-side?
2. **Pricing source of truth**: Service `basePrice` × Provider `priceMultiplier` × `durationHrs`? Or is duration a multiplier too? Need a single function used by both quote and booking create.
3. **First admin**: do you want me to add an interactive `scripts/create-admin.js` prompt, or stick with the env-var bootstrap in `scripts/seed.js`?
4. **Region**: `ap-south-1` (Mumbai) is the default in this plan given the Bengaluru addresses in mock data — confirm before we provision real tables.
5. **TypeScript yes/no**: plan is JS for speed; both clients are TS. Worth aligning?
