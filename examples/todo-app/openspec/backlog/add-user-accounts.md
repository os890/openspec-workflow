# Proposal

## Why

Before the app is used by more than one person, todos must belong to someone and be private by default.

## What Changes

- Sign-up with e-mail and password, login, logout; sessions as HTTP-only cookies.
- Every todo and project belongs to one user; the API only returns the caller's data.
- Existing todos are assigned to the first account created.

Out of scope: social login, password reset by e-mail (roadmap candidate).

## Capabilities

### New Capabilities
- `access/accounts`: sign-up, login and data per user.
