# Design

## Decisions

- **Todo** lives in `apps/api/src/tasks/` (domain + repository), the HTTP routes in `apps/api/src/http/`.
- Validation happens once, in the domain constructor; routes map violations to 422 problem+json.
- The web app keeps no client-side copy of the list beyond the current query result.
