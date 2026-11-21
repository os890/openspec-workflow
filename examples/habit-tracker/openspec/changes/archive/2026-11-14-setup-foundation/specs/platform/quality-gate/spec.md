## ADDED Requirements

### Requirement: Single quality gate
The project SHALL provide one command, `pnpm verify`, that runs lint, type check, tests with coverage thresholds,
the build and the E2E tests, and fails if any of them fails.

#### Scenario: All checks pass
- **WHEN** a developer runs `pnpm verify` on a clean checkout
- **THEN** the command exits with status 0
