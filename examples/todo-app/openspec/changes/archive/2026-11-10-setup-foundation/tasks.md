# Tasks

## 1. Workspace

- [x] 1.1 pnpm workspace with `apps/api`, `apps/web`, shared `tsconfig`; verify: `pnpm install --ignore-scripts && pnpm -r build` succeeds
- [x] 1.2 ESLint and Prettier for both apps; verify: an unformatted file fails `pnpm lint`

## 2. Gates

- [x] 2.1 Vitest with coverage thresholds in both apps; verify: coverage below 80 % fails `pnpm test`
- [x] 2.2 SQLite with migrations at start-up; verify: API test starts against a fresh database file
- [x] 2.3 Playwright smoke test against the production build; verify: `pnpm e2e` opens the app shell

## 3. Done

- [x] 3.1 `pnpm verify` is green
