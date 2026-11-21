# Proposal

## Why

Every later change needs a project that builds, tests and checks itself with one command. Setting the gates up
first is cheap; retrofitting them is not.

## What Changes

- pnpm workspace with `apps/api` (Fastify) and `apps/web` (React + Vite), shared TypeScript config.
- `pnpm verify`: ESLint, `tsc --noEmit`, Vitest with coverage thresholds (80 % lines), production build,
  Playwright smoke test against the built app.
- SQLite database file with migrations at start-up.

Out of scope: any todo functionality (`add-task-list`), CI hosting.

## Capabilities

### New Capabilities
- `platform/quality-gate`: one command that verifies the whole project.
