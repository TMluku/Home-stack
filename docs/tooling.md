# Tooling

Home Stack uses pnpm as the package manager and keeps developer workflows in package scripts.

## Commands

| Command | Purpose |
|---|---|
| `pnpm start` | Run the Node HTTP API server and static PWA on port `4173`. |
| `pnpm run start:static` | Serve the static files only with Python's simple HTTP server. |
| `pnpm test` | Run all Node.js unit/integration tests. |
| `pnpm run check:static` | Validate required files/snippets and parse the PWA manifest. |
| `pnpm run check` | Run static checks and tests. |
| `pnpm run ci` | Run Turbo tasks for static checks, tests, and Biome linting. |
| `pnpm run lint` | Run Biome checks. |
| `pnpm run format` | Format supported files with Biome. |
| `pnpm run docker:up` | Build and start the app with Docker Compose. |
| `pnpm run docker:down` | Stop the Docker Compose stack. |

## Turbo

`turbo.json` defines cacheable task names for `check:static`, `test`, `lint`, and `build`. The project is currently a single-package pnpm workspace, but the task graph is ready for future packages such as `apps/web`, `apps/api`, or `packages/domain`.

## Biome

`biome.json` centralizes formatting and linting. It is intentionally dependency-light and can replace separate formatter/linter tools for JavaScript, JSON, CSS, and supported web assets.

## Lefthook

`lefthook.yml` runs Biome and static checks before commit, and the Node test suite before push. Install hooks with:

```sh
pnpm exec lefthook install
```

## Docker Compose

`compose.yaml` builds the local image from `Dockerfile`, runs `pnpm start`, and exposes the app/API on `http://localhost:4173`.
