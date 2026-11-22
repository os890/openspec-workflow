---
name: openspec-ticket-workflow
description: Runs one OpenSpec change as a ticket through a spec-driven workflow with fresh agents - elaborate just in time, implement with tests, quality gate, acceptance check, diff review, independent validation of findings, Pareto fixes, docs, quality gate, archive and one commit. Use when starting, continuing or finishing a ticket (an OpenSpec change), when picking the next ticket from a roadmap/backlog, or when setting this workflow up in a project that uses OpenSpec.
---

# OpenSpec ticket workflow

One ticket = one OpenSpec change = one commit. You (the main agent) own the ticket and implement it. Every
check is done by a **fresh agent**: a sub-agent or new session that has not seen the implementation and gets
only the inputs named below. Never let the implementing context accept, review or validate its own work.

Terms used here:

| Term | Meaning |
|---|---|
| Quality gate | The project's single full build command (tests, coverage, linters, architecture rules, E2E). Find it in the project's agent instructions (CLAUDE.md, AGENTS.md) or `openspec/config.yaml`. |
| Roadmap | `openspec/roadmap.md`: ordered table of planned changes with their prerequisites. |
| Backlog | `openspec/backlog/<change>.md`: short draft proposals for changes that have not started. |
| Parking lot | An OpenSpec change (e.g. `parking-lot`) whose `tasks.md` collects deferred minors, known issues, trade-offs and revisit topics. It is never archived. |
| Pareto | Fix now what is high value and low effort; defer the rest to the right place. |

If the project does not have these yet, run **Setup** first.

## Setup (once per project)

1. Add the workflow to `openspec/config.yaml`: merge [references/config-snippet.yaml](references/config-snippet.yaml)
   and replace `<quality gate>` with the project's build command.
2. Create `openspec/roadmap.md` and one draft per planned change in `openspec/backlog/`, using
   [references/templates.md](references/templates.md).
3. Create the parking-lot change (`openspec new change parking-lot` or another name) with the parking-lot
   `tasks.md` from the templates.
4. Add one line to the project's agent instructions: "Follow the ticket workflow in `openspec/config.yaml`;
   one OpenSpec change = one ticket = one commit."

## Picking the next ticket

Take the first roadmap row whose change is not archived and whose prerequisites are all archived. If the user
named a ticket, use that one and say which prerequisites are still open. A change that already exists in
`openspec/changes/` is continued, not recreated.

## The workflow

Work through the steps in order. Do not skip a step; if a step does not apply (no docs affected), say so.

1. **Elaborate just in time.** If the change is still a backlog draft, create it (`openspec new change <name>`)
   and move the draft in as `proposal.md`. Write `design.md`, the spec deltas and `tasks.md`
   (`/openspec-continue-change` or `/openspec-ff-change`). Every task ends with `verify: <test, command or
   observable behaviour>`; spec scenarios are the ticket's acceptance criteria; the last task is "quality gate is
   green". Run `openspec validate <name>` and fix what it reports. Design it to fit the existing structure: the
   quickest way to the ticket's goal is not the right one when it leaves the code harder to change.
2. **Implement with tests** (`/openspec-apply-change`). Tick a task in `tasks.md` only when its `verify:`
   criterion is met, not when the code is written.
3. **Quality gate.** Run it. Red: fix and repeat. Never lower a threshold, skip a check or weaken a test to get
   green.
4. **Acceptance check.** Start a fresh agent with the "Acceptance check" prompt from
   [references/agent-prompts.md](references/agent-prompts.md) (`/openspec-verify-change`, read-only). For every
   reported gap decide by Pareto:
   - fix it now → back to step 2;
   - the implemented behaviour is the right one → record it with `/openspec-update-change` so spec and design
     describe what was built, then re-check;
   - defer → parking lot or a roadmap candidate, with the reason.
   Continue only when every scenario is satisfied with evidence or recorded as a deviation.
5. **Diff review.** Stage the ticket's changes. Start a fresh agent with the "Diff review" prompt; it sees only
   the staged diff and the change's artifacts. If the project's workflow includes the long-term check
   (`openspec/config.yaml` or the agent instructions), start another fresh agent with the "Long-term check" prompt
   as well: does doing the change this way, now and quickly, hurt the structure and maintainability in the long
   run? The diff review looks at the lines; this check looks at the direction the change takes the code.
6. **Validate the findings.** Start another fresh agent with the "Findings validation" prompt and the raw
   findings. It confirms or rejects each finding and classifies confirmed ones as `pareto` (high value, low
   effort) or `minor`.
7. **Fix the pareto findings.** Route the rest:
   - changes externally visible behaviour → describe the behaviour actually built with `/openspec-update-change`
     and add the improvement as a candidate row to the roadmap;
   - belongs to a planned change → add it to that change's backlog draft;
   - pure code-quality minor → parking lot.

   And the long-term check's verdict:
   - `sound` → nothing to do;
   - `tactical` → an acceptable shortcut for now: record it in the parking lot under "Trade-offs to revisit" (what the
     sound solution would be, and when it has to be done at the latest, e.g. before a named roadmap change) and, when
     it needs a change of its own, as a roadmap candidate;
   - `harmful` → do not commit it like this: restructure it when that fits the ticket (it costs less now than later);
     when it would grow the ticket considerably, stop and ask the user (restructure now, or accept it as tactical).
8. **Docs.** Decide whether user docs, architecture docs or decision records are affected. If so, start a fresh
   docs agent, then a separate fresh diagram agent for diagrams, each with its prompt. Diagrams are validated by
   rendering them.
9. **Quality gate** again. Red: back to step 7.
10. **Archive and commit.** `openspec archive <name>` (`/openspec-archive-change`), then make exactly one commit
    for the whole ticket, archive included, so the next change builds on archived specs. Follow the branch strategy
    in `openspec/config.yaml` or the agent instructions: by default on the main branch; with a branch per ticket,
    the ticket starts on a new branch named after the change and is merged once it is done; with a branch per
    milestone, its tickets are committed to the milestone's branch, merged once the milestone is done.

## Rules

- One change, one ticket, one commit; never archive a change in a later commit than its code.
- Create changes just in time; future work stays a short draft in the backlog.
- Fresh agents get only what their prompt lists, never your reasoning or conclusions.
- Behaviour changes go through the spec; never silently implement something different from a scenario.
- The parking lot is never archived. At every milestone, triage it and promote items to real changes early.
- Never lower a quality-gate threshold.

## Messages from the OpenSpec dashboard

If the user follows the session in the OpenSpec dashboard, some messages come in a fixed form: reactions and
requests about one of your answers (`[Reaction 👍 to your message: "…"]`, `[Request 📝 about your message: "…"]`),
quotes (`[Replying to your message: "…"]`) and quick messages (👀 status, ⏸ pause after this step, 🧪 run the
quality gate, ▶️ / ⏹️ / 🔃 start, stop or restart the app, …). What each one means is in [references/dashboard-messages.md](references/dashboard-messages.md).
Answer such a message briefly at the next sensible point and continue, unless it asks you to stop or wait.

## Report

At the end of a ticket, report in a few lines: the change name and commit, the acceptance result (scenarios
satisfied / deviations recorded), findings fixed / deferred and where they went, docs touched, and the next
ticket the roadmap allows.
