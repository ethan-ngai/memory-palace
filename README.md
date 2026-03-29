# Loci

Loci is a study-to-spatial-memory app. It turns imported study material into concept objects, generates 3D assets for those concepts, and places them inside a preloaded room so the user can review information as a visual memory palace.

## What The App Does

- Imports study material from pasted text or PDFs
- Extracts concepts and stores them in MongoDB
- Generates metaphor-backed object prompts for each concept
- Calls a 3D generation pipeline to create GLB assets
- Loads a room scan plus room anchors in a Three.js viewer
- Places generated objects into the room and lets the user inspect what each object represents

## Tech Stack

- TanStack Start
- React
- Three.js
- Auth0
- MongoDB Atlas
- RunPod
- Cloudflare R2
- Zod
- Vite

## High-Level Architecture

### Frontend

- TanStack Start for the full-stack app shell
- React for UI
- Three.js for the room viewer and object interaction
- Spark `SplatMesh` for room splat rendering

### Backend

- TanStack server functions for client-callable backend actions
- Auth0 / OpenID Connect for authentication
- MongoDB Atlas for rooms, concepts, metaphors, and asset metadata
- Zod for request and payload validation

### Storage / Asset Delivery

- Durable object storage for generated GLBs and previews
- Same-origin asset proxying for browser-safe model loading in the viewer

## Image / 3D Generation Pipeline

The generation pipeline is concept-first, then metaphor-first, then asset-first.

### Pipeline Stages

1. Study material is imported.
2. Concepts are extracted from text or PDFs.
3. Concepts are persisted into the active room.
4. A metaphor layer chooses a concrete stand-in object for each concept.
5. The 3D generation service creates a model for that metaphor.
6. The generated asset is uploaded to durable storage.
7. The viewer fetches ready assets and places them into the room.

### Pipeline Stack

- Concept extraction: local parsing and feature server logic
- Metaphor generation: room/concept server pipeline with deterministic fallback behavior
- 3D generation provider: TRELLIS via `@gradio/client`
- Asset upload/storage: S3-compatible object storage
- Asset delivery: proxied GLB loading into the Three.js viewer

### Current Pipeline Output

For each concept, the app can store:

- the concept label
- the concept description
- the generated metaphor object name
- the metaphor rationale when one exists
- the generated 3D asset URL
- the preview URL when available

## Room Viewer

The `/play` experience is the core MVP surface.

It supports:

- loading a bundled or uploaded room scan (`.spz` / `.ply`)
- importing room anchor JSON
- placing generated concept objects into the room
- clicking placed objects to inspect what they represent

## Project Structure

- `src/routes`: thin route files
- `src/features/<feature>/functions.ts`: client-callable server functions
- `src/features/<feature>/server`: server-only logic
- `src/features/<feature>/components`: UI
- `src/features/<feature>/types.ts`: shared feature contracts
- `src/lib`: shared infrastructure
- `public/rooms`: bundled room scans and matching anchor JSON files

## Running The App

Install dependencies:

```bash
vp install
```

Start local development:

```bash
vp exec vite dev
```

Typecheck:

```bash
vp exec tsc --noEmit
```

Run tests:

```bash
vp exec vitest run -c vitest.config.ts
```

Build:

```bash
vp exec vite build
```

## Environment

Copy `.env.example` to `.env` and provide values for the server integrations.

Core variables:

- `AUTH0_DOMAIN`
- `AUTH0_CLIENT_ID`
- `AUTH0_CLIENT_SECRET`
- `APP_BASE_URL`
- `MONGODB_URI`
- `MONGODB_DB_NAME`
- `SESSION_COOKIE_SECRET`

Pipeline-related variables commonly needed for object generation and delivery:

- `TRELLIS_GRADIO_URL`
- `ASSET_S3_PUBLIC_BASE_URL`
- storage credentials required by the S3-compatible upload layer

Client-safe variable:

- `VITE_APP_NAME`
