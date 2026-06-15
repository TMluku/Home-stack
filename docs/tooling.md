# Tooling

Home Stack is now a Next.js + TypeScript app using the App Router.

## Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install Next.js, React, TypeScript, Biome, Turbo, and Lefthook dependencies. |
| `pnpm dev` | Run the Next.js development server. |
| `pnpm build` | Build the production Next.js app. |
| `pnpm run build:pages` | Build the static GitHub Pages export and add `out/.nojekyll`. |
| `pnpm run deploy:pages-branch` | Publish an existing `out/` export to the `gh-pages` branch. |
| `pnpm start` | Serve the production build with `next start`. |
| `pnpm run typecheck` | Run TypeScript type checking. |
| `pnpm test` | Run the Vitest verification suite. |
| `pnpm run check` | Run type checking, linting, and tests. |
| `pnpm run clean:generated` | Remove local build, export, preview, log, dependency, and server-state artifacts. |
| `pnpm run lint` | Run Biome checks. |
| `pnpm run format` | Format supported files with Biome. |
| `pnpm run docker:up` | Build and start the app with Docker Compose. |
| `pnpm run docker:down` | Stop the Docker Compose stack. |

## Project Layout

| Path | Purpose |
|---|---|
| `src/app` | Next.js App Router entry, metadata, and global styles. |
| `src/components` | Client-side React components for the MVP workflow. |
| `src/lib` | TypeScript domain types, demo state, offer data, and replenishment logic. |
| `public` | Manifest and icon assets served from the app root. |

## Turbo

`turbo.json` defines cacheable task names for `typecheck`, `test`, `lint`, and `build`. The project is currently a single-package pnpm workspace, but the task graph is ready for future packages such as `apps/web`, `apps/api`, or `packages/domain`.

## Biome

`biome.json` centralizes formatting and linting. It covers TypeScript, TSX, JSON, CSS, and supported web assets.

## Lefthook

`lefthook.yml` runs Biome and TypeScript checks before commit, and the verification suite before push. Install hooks with:

```sh
pnpm exec lefthook install
```

## Docker Compose

`compose.yaml` builds the local image from `Dockerfile`, runs the Next.js production server, and exposes the app on `http://localhost:4173`.
