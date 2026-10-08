# CVR → Pipedrive Sync

A **single-tenant, self-hosted** Pipedrive custom-panel app that pulls Danish
CVR registry data onto a Pipedrive **Organization** record. Deploy your own
copy (Vercel + private Pipedrive app). It is intentionally **not** a
multi-tenant SaaS / Marketplace listing.

> To point it at a Pipedrive account you set env vars and register a private
> app in that account's Developer Hub. There are **no code changes** and
> **no multi-tenant path** — this is intentional.

## What it does

In the Organization detail view, a panel lets you look up a CVR number against the
official Danish CVR register via [Datafordeler GraphQL](https://datafordeler.dk/dataoversigt/det-centrale-virksomhedsregister-cvr/cvr-graphql/)
and write selected fields onto the organization.

### Synced fields

| Panel field | Pipedrive target | Type | Source |
|---|---|---|---|
| Navn | `name` (standard) — **overwritten** with the official CVR name | varchar | `name` |
| Adresse | `address` (standard) | address | assembled `street, zip city` |
| CVR-nummer | existing **"CVR"** field (reused) | double | `cvr` |
| Selskabsform | "Selskabsform" (custom) | varchar | `companyForm` |
| Branche | "Branche" (custom) | varchar | `industryDesc` (Danish text) |
| Branchekode | "Branchekode" (custom) | varchar | `industryCode` |
| Antal ansatte | native **"Number of employees"** (`employee_count`, reused) | int | `employees` |
| — | "CVR Sidst Synkroniseret" (custom) | date | always stamped on sync |

Custom fields are resolved by **label** on first use (their 40-char hash keys are
not hardcoded). Missing custom fields are created automatically; existing ones
are reused — the setup is idempotent.

### GDPR / legal

- CVR data comes from Erhvervsstyrelsen via Datafordeler and is licensed under
  **CC BY 4.0** — credit Erhvervsstyrelsen when you redistribute the data.
- **Phone and email are never synced.** Organizations have no native phone/email
  field, and the CVR adapter additionally nulls them for **reklamebeskyttede**
  (advertising-protected) companies.
- **Reklamebeskyttelse** and **ophørt** (ceased) conditions are surfaced as
  warnings in the panel UI so the user is aware before syncing.
- You do **not** need CVRPerson access for this app (only company entities).

## Architecture

Monorepo (npm workspaces), TypeScript everywhere, deployed as **one Vercel
project**:

- **Frontend** (`packages/frontend`) — Vite + React + `@pipedrive/app-extensions-sdk`.
  Built to static files, served from Vercel's CDN. Because it is static, the
  panel initializes well within Pipedrive's 10-second iframe limit.
- **Backend** (`packages/backend`) — Node + Express, run as a **Vercel serverless
  function** under `/api/*` (`api/[...path].ts` → `packages/backend/src/serverless.ts`).
  Same origin as the frontend, so no CORS.
- **Stateless** — no database. The Pipedrive personal API token comes from an env
  var; custom-field hash keys are resolved lazily and memoized per warm instance
  (one `listOrganizationFields` call on a cold start). CVR lookups are cached
  in-memory for 24h (`node-cache`, best-effort per instance).
- **CVR provider** — Datafordeler GraphQL (`CVR_PROVIDER=datafordeler`). The
  `cvr/` module is the only place that knows provider-specific field names;
  everything else uses the canonical `CvrCompany` model. Lookups use two GraphQL
  round-trips (Virksomhed by CVR number, then related entities by CVREnhedsId).

### API

| Route | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness |
| `GET /api/cvr/:cvrnr` | none | CVR lookup (8-digit validation) → `CvrLookupResult` |
| `GET /api/org/:id` | JWT | Org's current name + existing CVR + last-synced |
| `POST /api/sync` | JWT | Write opted-in fields; no silent partial commits |
| `POST /api/webhook` | Basic | Auto-sync on `updated.organization` (see below) |

`POST /api/sync` body: `{ organizationId: number, cvrnr: string, fields: string[] }`.
On a Pipedrive write failure it returns **502** with structured errors and reports
no success. Not-found → 404, CVR quota → 503, bad input → 400.

## Automatic sync (webhook)

When a CVR number is added to or changed on an organization, the fields update
automatically — no need to open the panel.

- Register a Pipedrive **webhook** (v2.0) on **`updated` / `organization`** pointing
  at `https://<your-vercel-domain>/api/webhook`, with HTTP Basic auth matching
  `PIPEDRIVE_WEBHOOK_USER` / `PIPEDRIVE_WEBHOOK_PASSWORD`.
- The handler fires a full auto-sync (all available fields) **only when the CVR
  field value actually changed** (`current` vs `previous` in the payload). It
  handles both v1 (`current`/`previous`, `meta.id`) and v2 (`data`/`previous`,
  `meta.entity_id`) payloads.
- **Loop prevention:** the app's own write re-sends the same CVR value, so the
  follow-up `updated.organization` event shows no CVR change and is skipped.
- Responses: handled/skipped → **200**; a bad (not-found) CVR is acked **200**
  (not retryable); transient errors (quota / lookup / write) → **502** so
  Pipedrive retries.

Create the webhook via the API once deployed, e.g.:

```bash
curl -X POST "https://<COMPANY_DOMAIN>.pipedrive.com/api/v1/webhooks?api_token=$PIPEDRIVE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "subscription_url": "https://<your-vercel-domain>/api/webhook",
    "event_action": "updated",
    "event_object": "organization",
    "version": "2.0",
    "http_auth_user": "'"$PIPEDRIVE_WEBHOOK_USER"'",
    "http_auth_password": "'"$PIPEDRIVE_WEBHOOK_PASSWORD"'"
  }'
```

## Authentication

- **Pipedrive API** (server → Pipedrive): a **personal API token** (`PIPEDRIVE_API_TOKEN`).
  No OAuth.
- **Panel → backend**: every authenticated call attaches the iframe JWT from
  `getSignedToken()` as `Authorization: Bearer <jwt>`. The backend verifies the
  HS256 signature with `PIPEDRIVE_JWT_SECRET` (the app's client secret) and
  rejects missing/invalid/expired tokens (401). If `PIPEDRIVE_COMPANY_ID` is set,
  the token's company id must match it (403 otherwise) — a single-tenant guard.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables) and, for local
dev, in a `.env` file (see `.env.example`).

| Variable | Required | Notes |
|---|---|---|
| `DATAFORDELER_API_KEY` | yes | Free API key from [Datafordeler Administration](https://datafordeler.dk) (user + IT-system). No CVRPerson application needed. |
| `CVR_PROVIDER` | no | `datafordeler` (default / only supported) |
| `DATAFORDELER_GRAPHQL_URL` | no | Defaults to `https://graphql.datafordeler.dk/CVR/v1` |
| `PIPEDRIVE_API_TOKEN` | for sync | Personal API token (Settings → Personal preferences → API) |
| `PIPEDRIVE_COMPANY_DOMAIN` | for sync | e.g. `yourco` (from `yourco.pipedrive.com`) |
| `PIPEDRIVE_JWT_SECRET` | for sync | App **client secret** from the Developer Hub |
| `PIPEDRIVE_COMPANY_ID` | recommended | Enforces the single-tenant company guard |
| `PIPEDRIVE_CLIENT_ID` / `PIPEDRIVE_CLIENT_SECRET` | for install | Completes OAuth install so UI extensions activate (tokens not stored) |
| `PIPEDRIVE_WEBHOOK_USER` | for auto-sync | Basic-auth user for the webhook; match it when creating the webhook |
| `PIPEDRIVE_WEBHOOK_PASSWORD` | for auto-sync | Basic-auth password for the webhook |
| `PORT` | no | Local only (default 3000) |
| `NODE_ENV` | no | |

The frontend talks to the backend at the **same origin** by default. For local
dev pointed at a remote backend, set `VITE_API_BASE_URL`.

## Local development

```bash
npm install

# Copy env and fill in DATAFORDELER_API_KEY (+ Pipedrive vars for sync)
cp .env.example .env

# Terminal 1 — backend (CVR lookups need Datafordeler; sync needs Pipedrive)
npm run dev --workspace @cvr-pipedrive/backend

# Terminal 2 — frontend (Vite dev server proxies /api → localhost:3000)
npm run dev --workspace @cvr-pipedrive/frontend
```

### Datafordeler API key

1. Create a user at [datafordeler.dk](https://datafordeler.dk) (MitID or email/password).
2. In Administration, create an **IT-system** and an **API key**.
3. Put the key in `DATAFORDELER_API_KEY`. You do **not** need to apply for CVR
   access unless you later want the restricted `CVRPerson` entity.

Open http://localhost:5173. Outside the Pipedrive iframe the panel still does CVR
lookups and preview/toggle; **sync is disabled** (no `getSignedToken()`).

### Tests & typecheck

```bash
npm test                                            # backend (vitest)
npm run typecheck --workspace @cvr-pipedrive/backend
npm run typecheck --workspace @cvr-pipedrive/frontend
```

## Deploy to Vercel

1. Push the repo to GitHub and **import it into Vercel** as a new project. Keep the
   repo root as the project root — `vercel.json` configures the build:
   - Build command: `npm run build --workspace @cvr-pipedrive/frontend`
   - Output: `packages/frontend/dist`
   - The backend is the serverless function `api/index.js` (bundled Express app).
2. Add the environment variables above (Production + Preview).
3. Deploy. The static panel is served from the CDN; `/api/*` hits the function.
4. The first authenticated request resolves/creates the custom fields (idempotent).

> Serverless note: cold starts are sub-second and add a little latency only to the
> first API call after idle — not to panel initialization (the frontend is
> static). In-memory caches are per warm instance; this is fine for an internal,
> low-traffic tool.

## Register the app in Pipedrive (private / unlisted)

In the [Pipedrive Developer Hub](https://developers.pipedrive.com/):

1. Create a **private app** (do **not** submit to the Marketplace). Develop/test
   against a sandbox first if you have one, then install into production.
2. Add a **Custom UI extension → Custom Panel** on the **Organization detail**
   view, pointing its iframe URL at the deployed frontend URL (the Vercel domain).
3. Set the app's **client secret**; put the same value in `PIPEDRIVE_JWT_SECRET`
   so the backend can verify the iframe JWT. Also set `PIPEDRIVE_CLIENT_ID` /
   `PIPEDRIVE_CLIENT_SECRET` and the OAuth callback to
   `https://<your-domain>/api/oauth/callback` so installation finalizes.
4. The org id arrives on the iframe URL as a query parameter (`selectedIds` / `id`);
   the panel reads it from `window.location`.
5. The Pipedrive **API** calls use the personal API token from env — install
   OAuth tokens are exchanged then discarded.

### Caveats to confirm during registration

- **JWT claim names.** The backend verifies the signature + expiry (the real
  security guarantee) and extracts `userId` / `companyId` defensively from several
  candidate claim names. When `PIPEDRIVE_COMPANY_ID` is set, a matching
  `companyId` claim is **required** (fail-closed).
- **Org id URL param.** Confirm `selectedIds` (or `id`) is present on the real
  iframe URL for the Organization panel.
- **Webhook auth.** `PIPEDRIVE_WEBHOOK_USER` + `PIPEDRIVE_WEBHOOK_PASSWORD` are
  mandatory for auto-sync — the webhook route is not mounted without them.

## Out of scope (v1)

Bulk sync, P-enheder, Deals/Persons sync, multi-language, financials, CVRPerson.
(Webhook auto-sync was originally out of scope but has since been added — see above.)
