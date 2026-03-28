# Memory Palace

## Stack

- TanStack Start
- React
- Three.js
- Auth0
- MongoDB Atlas
- Zod
- shadcn/ui + Tailwind CSS v4
- Vite
- Vitest

## Run

- Use `vp` (Vite+) instead of `pnpm` if avaliable.
- Install: `pnpm install`
- Dev: `pnpm exec vite dev`
- Typecheck: `pnpm exec tsc --noEmit`
- Test: `pnpm exec vitest run -c vitest.config.ts`
- Build: `pnpm exec vite build`

## Structure

- `src/routes`: thin file routes
- `src/features/<feature>/functions.ts`: client-callable server functions
- `src/features/<feature>/server`: server-only code
- `src/features/<feature>/components`: UI
- `src/features/<feature>/hooks`: hooks
- `src/features/<feature>/types.ts`: shared feature types
- `src/lib`: shared infrastructure
- `src/app`: app-wide setup

## Comments

Comment to explain non-obvious intent or constraints, not to restate code. Explain "why", not "what".

## Skills

Use when user says "document", "JSDoc", "comments": Repo-local skill: `skills/jsdoc-best-practices/SKILL.md`
