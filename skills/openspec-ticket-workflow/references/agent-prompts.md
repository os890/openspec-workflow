# Prompts for the fresh agents

Fill in the `<…>` parts and pass nothing else: no summary of the implementation, no opinion about its quality.
Each agent answers in the format its prompt asks for, so the main agent can act on the result directly.

## Acceptance check (step 4)

```text
You check whether OpenSpec change `<name>` is done. Work read-only: do not edit files, do not fix anything.

Inputs: openspec/changes/<name>/ (proposal.md, design.md, specs/, tasks.md) and the repository.
You may run read-only commands and the tests: <quality gate or test commands>.

1. For every scenario in the change's spec deltas: find the test or observable behaviour that proves it.
   Answer satisfied / not satisfied / partly, with the evidence (test name and file, command output).
2. For every task in tasks.md: is its `verify:` criterion met? Ticked tasks whose criterion is not met are gaps.
3. Definition of Done: quality gate green, every scenario satisfied, every task criterion met, no TODO left
   for this change.

Answer with a table per scenario and per task (item, result, evidence), then a list of gaps, each with what is
missing and the smallest change that would close it. No praise, no summary of the code.
```

## Diff review (step 5)

```text
Review the staged diff (`git diff --staged`) of OpenSpec change `<name>` for code quality.
Context you may read: openspec/changes/<name>/ and the files the diff touches. Review only what the diff changes.

Look for: bugs and missing edge cases, violations of the project's architecture rules and conventions
(<pointer to CLAUDE.md / AGENTS.md / architecture docs>), missing or weak tests, unclear names, duplication,
dead code, error handling, security issues.

Answer with one finding per entry: file:line, what is wrong, why it matters, suggested fix, your estimate of
value (high/low) and effort (high/low). Answer "0 findings" if there are none. No praise, no summary.
```

## Long-term check (step 5, when the project's workflow includes it)

```text
Check whether OpenSpec change `<name>` takes the code in a direction that is sound in the long run, or whether
it reaches the ticket's goal quickly at the cost of the structure and maintainability. Work read-only: do not
edit files, do not fix anything.

Inputs: the staged diff (`git diff --staged`), openspec/changes/<name>/ (proposal.md, design.md, specs/), the
code around what the diff touches, the architecture and conventions (<pointer to CLAUDE.md / AGENTS.md /
architecture docs / decision records>) and openspec/roadmap.md with the backlog drafts (what is planned next).

1. Structure: does the change put things where they belong, or does it bypass layers and module boundaries, add
   coupling or a dependency in the wrong direction, special-case a general concept, or copy instead of reuse?
2. Consistency: does it follow the patterns the code already uses for the same problem, or add a second way?
3. Change ahead: will the planned changes of the roadmap build on it, or have to rework it? Does it fix the cause
   or a symptom? Does it lock in a data format, an API or a dependency that is hard to change later?
4. Cost: for each problem, the sound alternative, the effort now (low/high) and what it costs later if left.

Answer with one entry per problem (what, where: file or design decision, why it hurts in the long run, the
sound alternative, effort now, cost later), then one verdict: `sound`, `tactical` (an acceptable shortcut
for now, with what has to be revisited and by when) or `harmful` (should not be committed like this).
Answer "sound, 0 problems" if there are none. No praise, no summary of the code.
```

## Findings validation (step 6)

```text
Validate the review findings below for OpenSpec change `<name>`. You did not write them and you did not write
the code. For each finding, read the code it points to and decide:

- confirmed or rejected (with the reason; reject findings that are wrong, out of the diff's scope, duplicates
  or pure taste);
- for confirmed ones: `pareto` (high value, low effort: fix in this ticket) or `minor`;
- whether fixing it would change externally visible behaviour (API, UI, stored data).

Answer with a table: finding id, verdict, reason, class (pareto/minor), behaviour change (yes/no).

Findings:
<paste the raw findings>
```

## Docs (step 8)

```text
OpenSpec change `<name>` is implemented (staged diff: `git diff --staged`). Update the project documentation so
it matches the code: <user manual path>, <architecture docs path>, <decision records path>.

Rules: document behaviour and structure that changed, nothing else; keep the existing structure and tone;
write a decision record only for <the project's rule for ADRs>. Do not edit code or specs.
Answer with the list of files changed and one line per change.
```

## Diagrams (step 8)

```text
OpenSpec change `<name>` changed <what changed>. Add or update the diagrams in <docs path> so they match the
code: <diagram kinds the project uses, e.g. building blocks, runtime sequences, deployment>.

Rules: one diagram per question it answers; label every element with names from the code; render every
diagram you touch with <render command, e.g. mermaid-cli or PlantUML in a container> and fix all errors.
Answer with the diagrams changed and the render result.
```
