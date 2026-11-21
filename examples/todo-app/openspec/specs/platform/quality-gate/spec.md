# platform/quality-gate Specification

## Purpose
One command verifies the whole project, so every change ends with the same check.

## Requirements

### Requirement: Single quality gate
The project SHALL provide one command, `pnpm verify`, that runs lint, type check, all tests with coverage
thresholds, the production build and the E2E tests, and fails if any of them fails.

#### Scenario: All checks pass
- **WHEN** a developer runs `pnpm verify` on a clean checkout
- **THEN** the command exits with status 0

#### Scenario: Coverage below threshold
- **WHEN** line coverage of an app drops below 80 %
- **THEN** `pnpm verify` fails and names the app
