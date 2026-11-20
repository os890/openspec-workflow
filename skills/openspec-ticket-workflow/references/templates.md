# Templates

## openspec/roadmap.md

```markdown
# Roadmap

One OpenSpec change per row, in implementation order. A change exists only as a draft in `openspec/backlog/`
until its work starts. "Depends on" lists hard prerequisites (row numbers); numbers in parentheses are soft.

| Order | Change | Area | Depends on | Goal |
|---|---|---|---|---|
| 1 | `setup-foundation` | platform | — | Build skeleton with all quality gates enforced. |
| 2 | `add-first-feature` | <area> | 1 | First complete vertical slice. |

## Milestones

- **M0 "Walking skeleton"** (1–2): the build, its gates and one complete vertical slice.

## Candidates (not yet planned)

- <improvements found during tickets, with the ticket that found them>
```

## openspec/backlog/&lt;change&gt;.md

```markdown
# Proposal

## Why

<The problem or opportunity, in two or three sentences.>

## What Changes

- <Capabilities added or changed, at the level a reviewer can check.>

Out of scope: <what this change deliberately does not do, and which change does it instead>.

## Capabilities

### New Capabilities
- `<area>/<capability>`: <one line>
```

## Parking lot: openspec/changes/&lt;parking-lot&gt;/tasks.md

```markdown
# Tasks

Parking lot for deferred items. It is never archived; triage it at every milestone.
Format of an item:
`- [ ] <group>.<n> [<kind>] <what> — origin: <ticket/commit>; done when: <criterion>`
with kind one of `review-minor`, `known-issue`, `trade-off`, `revisit`.

## 1. Review minors

## 2. Known issues

## 3. Trade-offs to revisit
```
