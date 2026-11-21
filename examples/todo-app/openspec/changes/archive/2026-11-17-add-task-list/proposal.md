# Proposal

## Why

The first vertical slice: a user can write down what they need to do and tick it off. It proves the stack end to
end, from the form to the database.

## What Changes

- Todo with title (1–200 characters), done flag, creation time.
- REST: `GET/POST /api/v1/todos`, `PATCH /api/v1/todos/{id}`, `DELETE /api/v1/todos/{id}`.
- List page: add, complete, delete; completed todos at the bottom.
- Playwright E2E: add → complete → delete.

Out of scope: due dates (`add-due-dates`), projects (`add-projects`), users (`add-user-accounts`).

## Capabilities

### New Capabilities
- `tasks/task-list`: create, list, complete and delete todos.
