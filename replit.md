# Course Learning Platform

An Arabic-first English-learning platform for learners and course administrators.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/course-app run dev` — run the learner and admin web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`
- Supabase schema and setup steps: `artifacts/course-app/docs/supabase-setup.md`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/course-app/` — Arabic learner experience, administrator pages, course management, and Supabase setup SQL
- `artifacts/api-server/` — authenticated admin account and protected media endpoints
- `lib/api-spec/openapi.yaml` — source of truth for the shared API contract
- `lib/api-client-react/` and `lib/api-zod/` — generated API clients and validation schemas

## Architecture decisions

- Supabase Auth, database, and Storage own course and learner data.
- Browser configuration uses the public Supabase URL and anon key; the service-role key is server-only.
- Protected course media is delivered through short-lived signed URLs after server-side access checks.
- The shared API server is routed at `/api`; the web app is served at `/`.

## Product

Learners access courses, lessons, and progress in an Arabic-first mobile web experience. Administrators sign in to manage courses, content, and learner accounts. Supabase credentials and SQL setup are required before connecting the app to live data.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run the SQL scripts listed in the Supabase setup guide before expecting live course data.
- Never add `SUPABASE_SERVICE_ROLE_KEY` to a `VITE_` variable; it must remain server-only.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
