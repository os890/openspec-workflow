# Tasks

## 1. Domain

- [x] 1.1 `DueDate` value object (ISO date, optional); verify: unit tests for valid, invalid and empty input
- [x] 1.2 `Todo.isOverdue(today)`; verify: unit tests for before, on and after the due date and for done todos

## 2. API

- [x] 2.1 Migration `003_due_date` adds a nullable column; verify: migration test on an empty and a filled database
- [x] 2.2 Create and update accept `dueDate`, invalid dates give 422; verify: API test per spec scenario
- [x] 2.3 `GET /api/v1/todos?sort=due` sorts by due date, todos without one last; verify: API test

## 3. Web

- [x] 3.1 Clearable date picker in the todo form; verify: component test
- [ ] 3.2 Overdue todos highlighted in the list; verify: component test and E2E "overdue todo is highlighted"
- [ ] 3.3 Sort toggle "Due date"; verify: E2E "sort by due date"

## 4. Done

- [ ] 4.1 `pnpm verify` is green
