# Proposal

## Why

Most todos have a deadline. Without due dates users cannot see what is urgent, and reminders (`add-reminders`)
have nothing to work with.

## What Changes

- Optional due date (date without time) per todo, set and cleared in the todo form.
- Open todos whose due date has passed are shown as overdue.
- The list can be sorted by due date; todos without a due date come last.

Out of scope: times of day, recurring todos (roadmap candidate), reminders (`add-reminders`).

## Capabilities

### Modified Capabilities
- `tasks/task-list`: todos get an optional due date.

### New Capabilities
- `tasks/due-dates`: overdue state and sorting by due date.
