# Roadmap — Todo

One OpenSpec change per row, in implementation order. A change exists only as a draft in `openspec/backlog/`
until its work starts. "Depends on" lists hard prerequisites (row numbers).

| Order | Change | Area | Depends on | Goal |
|---|---|---|---|---|
| 1 | `setup-foundation` | platform | — | Project skeleton with lint, tests, build and E2E behind one `pnpm verify`. |
| 2 | `add-task-list` | tasks | 1 | Create, list, complete and delete todos. |
| 3 | `add-due-dates` | tasks | 2 | Optional due date per todo, overdue todos highlighted, sort by due date. |
| 4 | `add-projects` | organisation | 2 | Group todos into projects. |
| 5 | `add-search` | tasks | 2 | Filter todos by text and status. |
| 6 | `add-user-accounts` | access | 1 | Sign-up and login; every todo belongs to one user. |
| 7 | `add-reminders` | notifications | 3, 6 | E-mail reminders for todos that are due tomorrow. |
| 8 | `add-sharing` | organisation | 4, 6 | Share a project with other users. |

## Milestones

- **M0 "Walking skeleton"** (1–2): the build, its gates and the first complete vertical slice.
- **M1 "Personal todo list"** (3–5): everything one person needs to organise their own todos.
- **M2 "Multi-user"** (6–8): accounts, reminders and sharing.

## Candidates (not yet planned)

- Recurring todos (found while specifying `add-due-dates`).
- Keyboard shortcuts for the list.
