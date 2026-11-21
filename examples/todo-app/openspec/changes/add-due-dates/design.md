# Design

## Decisions

- **DueDate** is a value object in `apps/api/src/tasks/` holding an ISO date (`YYYY-MM-DD`); no time zone is stored.
- "Overdue" is computed, never stored: `dueDate < today` in the user's local date, and only for open todos.
- Sorting happens in SQL (`ORDER BY due_date IS NULL, due_date, created_at`), so pagination stays correct later.

## Risks

- The server and the browser can disagree about "today" around midnight. The web app sends its local date with
  the list request; the API uses it for the overdue flag.
