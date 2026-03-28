# Memory Palace

TanStack Start full-stack app scaffold with a Three.js game layer, Auth0 login flow, and MongoDB Atlas persistence.

## Tech Stack

- TanStack Start
- TanStack Router
- TanStack Query
- React
- Three.js
- Auth0
- MongoDB Atlas
- Zod
- Vite
- Vitest

## Run

Install dependencies:

```bash
pnpm install
```

Start the dev server:

```bash
pnpm exec vite dev
```

Typecheck:

```bash
pnpm exec tsc --noEmit
```

Run tests:

```bash
pnpm exec vitest run -c vitest.config.ts
```

Build:

```bash
pnpm exec vite build
```

## File Structure Conventions

- `src/routes`: thin TanStack file routes only
- `src/features/<feature>/functions.ts`: server functions callable by the client
- `src/features/<feature>/server`: server-only code
- `src/features/<feature>/components`: feature UI
- `src/features/<feature>/hooks`: feature hooks
- `src/features/<feature>/types.ts`: shared feature types
- `src/lib`: cross-feature infrastructure
- `src/app`: app-wide providers and router setup

## Environment

Copy `.env.example` to `.env` and fill in the values.

Required server variables:

- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `APP_BASE_URL`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `SESSION_COOKIE_SECRET`

Optional server variables:

- `AUTH0_AUDIENCE`

Client-safe variables:

- `VITE_APP_NAME`
