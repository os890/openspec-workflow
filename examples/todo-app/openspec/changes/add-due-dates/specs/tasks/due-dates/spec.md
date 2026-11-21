## ADDED Requirements

### Requirement: Due date
The system SHALL let a user set, change and clear an optional due date (a date without time) on a todo.

#### Scenario: Set a due date
- **WHEN** a user sets the due date of "Pay rent" to 2026-12-01
- **THEN** the todo shows "Dec 1" in the list

#### Scenario: Invalid date
- **WHEN** a client sends the due date "2026-02-30"
- **THEN** the request is rejected with 422 and the field `dueDate`

### Requirement: Overdue todos
An open todo whose due date is before today SHALL be shown as overdue. Done todos are never overdue.

#### Scenario: Overdue
- **WHEN** today is 2026-12-02 and "Pay rent" is open with due date 2026-12-01
- **THEN** the todo is highlighted as overdue

#### Scenario: Done todo
- **WHEN** an overdue todo is ticked as done
- **THEN** it is no longer highlighted

### Requirement: Sort by due date
The list SHALL be sortable by due date, earliest first; todos without a due date come last.

#### Scenario: Mixed due dates
- **WHEN** a user sorts todos due Dec 5, none, and Dec 1 by due date
- **THEN** the order is Dec 1, Dec 5, then the todo without a due date
