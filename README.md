# Appnomics Builder

The standalone builder app (builder.appnomics.dev). Describe what you want to launch; an intake chat asks a few
questions, shows what it will and will not build, then a worker builds it. This version runs the rule-based
interviewer and a stub builder, with real sign-in, saved projects, jobs, usage logging and tests. The model, the
builder agent and live publishing plug into the interfaces listed below.

Stack: Next.js 16 · React 19 · TypeScript · Tailwind 4 · shadcn/ui (copied in) · Drizzle · Postgres · Auth.js · Zod.
Decisions are in `knowledge/stack.json`.

## Run it

```bash
cp .env.example .env        # fill in the values below
npm install
npm run db:migrate
npm run dev                 # web app on :3000
npm run worker              # in a second terminal: runs build jobs
npm run test:e2e            # needs the app on :3100 and the worker; see e2e/flow.mjs
```

Local sign-in without Google: set `ALLOW_DEV_LOGIN=1` (ignored in production) and put your email in `ALLOWED_EMAILS`.

## Environment variables

| Variable | Needed for | Where it comes from |
| --- | --- | --- |
| `DATABASE_URL` | everything | Neon connection string (or local Postgres) |
| `AUTH_SECRET` | sign-in | `openssl rand -base64 32` |
| `AUTH_URL` | sign-in | the app's URL, e.g. `https://builder.appnomics.dev` |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Google sign-in | Google Cloud console, OAuth client; redirect URI `<AUTH_URL>/api/auth/callback/google` |
| `ALLOWED_EMAILS` | access control | comma-separated; adding someone here is how you share the builder |
| `ALLOW_DEV_LOGIN` | local only | `1` on your machine, unset in production |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | the model interviewer | Anthropic console (not used until the model interviewer is added) |
| `INTEGRATIONS` | publishing | `stub` (default) or `live` |
| `GITHUB_ORG`, `GITHUB_TOKEN`, `GITHUB_TEMPLATE_REPO` | publishing | org for stores; GitHub App or fine-grained token (create repos, write contents and PRs); the template repo |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | publishing | token scoped to one team; the Vercel GitHub integration installed on the org |
| `NEON_API_KEY` | per-app databases | Neon console |
| `WORKER_STEP_MS` | tests | pause per build step in the stub builder (default 700) |

Tokens stay server side and never go into an agent's context.

## How it fits together

- `src/lib/builder/` the brief (questions, capability list, edge rules, summary), store settings, verify checks. Same code as the prototype.
- `src/lib/workspace/` workspace state and its transitions (pure functions). The server runs intake turns; the worker finishes builds; the browser runs the iterate phase and saves it.
- `src/lib/agents/interviewer.ts` the interface a model replaces. Keep the signature and the validator.
- `src/lib/integrations/` GitHub, Vercel, Neon interfaces with stubs. `live` throws until implemented.
- `worker/index.ts` claims queued jobs and runs them. A build survives closing the tab.
- `src/db/schema.ts` users, projects (state as JSON), jobs, usage, interventions, publish requests.
- `knowledge/` the knowledge pack.

## Not built yet

- Model-backed interviewer, spec writer and spec checker.
- The builder agent (specs to repo to tests) in the worker; today it is a stub that draws the preview.
- Live GitHub, Vercel and Neon calls; the real preview deployment.
- Completion email (a build shows as ready in Your projects).
- Recording interventions from the UI (the table exists).
