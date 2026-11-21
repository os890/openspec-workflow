# Proposal

## Why

Every later change needs a project that builds and checks itself with one command.

## What Changes

- SvelteKit app with TypeScript, ESLint, Vitest with coverage thresholds and Playwright.
- `pnpm verify` runs all of them; SQLite with migrations at start-up.

## Capabilities

### New Capabilities
- `platform/quality-gate`: one command that verifies the whole project.
