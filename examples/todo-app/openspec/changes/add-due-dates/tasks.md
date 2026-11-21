# Tasks

## 1. Domain

- [x] 1.1 `DueDate` value object (ISO date, optional); verify: unit tests for valid, invalid and empty input
- [x] 1.2 `Todo.isOverdue(today)`; verify: unit tests for before, on and after the due date and for done todos

## 2. API

- [x] 2.1 Migration `003_due_date` adds a nullable column; verify: migration test on an empty and a filled database
- [x] 2.2 Create and update accept `dueDate`, invalid dates give 422; verify: API test per spec scenario
- [x] 2.3 `GET /api/v1/todos?sort=due` sorts by due date, todos without one last; verify: API test
- [ ] 2.4 The list request takes the client's local date and the response has an overdue flag per todo, computed with `Todo.isOverdue` (design: Risks); verify: API test for spec scenarios "Overdue" and "Done todo", and for a client date that differs from the server date

## 3. Web

- [x] 3.1 Clearable date picker in the todo form; verify: component test
- [ ] 3.2 Overdue todos highlighted in the list, using the overdue flag from the API; the list request sends the browser's local date; verify: component test (overdue, not overdue, done) and E2E "overdue todo is highlighted" and "overdue todo ticked as done is no longer highlighted"
- [ ] 3.3 Sort toggle "Due date"; verify: E2E "sort by due date" with todos due Dec 5, none and Dec 1 gives the order Dec 1, Dec 5, none
- [ ] 3.4 The due date is shown in the list as a short date (e.g. "Dec 1"), nothing when there is none; verify: component test and E2E "set a due date"

## 4. Done

- [ ] 4.1 `pnpm verify` is green, including the new API and E2E tests; every scenario in `specs/tasks/due-dates/spec.md` is covered by at least one test
