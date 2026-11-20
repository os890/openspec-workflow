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
