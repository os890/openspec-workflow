# Tasks

Parking lot for deferred items. It is never archived; triage it at every milestone.
Format of an item:
`- [ ] <group>.<n> [<kind>] <what> — origin: <ticket/commit>; done when: <criterion>`
with kind one of `review-minor`, `known-issue`, `trade-off`, `revisit`.

## 1. Review minors

- [x] 1.1 [review-minor] Repository returns `undefined` and `null` for "not found" — origin: add-task-list; done when: one convention, tests adjusted
- [ ] 1.2 [review-minor] Route handlers repeat the problem+json mapping — origin: add-task-list; done when: one shared error handler

## 2. Known issues

- [ ] 2.1 [known-issue] Deleting a todo has no undo — origin: add-task-list; done when: decided in M1 triage

## 3. Trade-offs to revisit

- [ ] 3.1 [trade-off] SQLite file per installation, no backups — origin: setup-foundation; done when: revisited before M2
