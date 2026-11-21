# OpenSpec ticket workflow

A reusable way to build software ticket by ticket with [OpenSpec](https://github.com/Fission-AI/OpenSpec) and
AI coding agents, from a draft in the backlog to an archived change and one commit. It does not depend on a
language, build tool or agent product: the **quality gate** is your project's full build, and a **fresh agent**
is any new session or sub-agent that has not seen the implementation.

The repository contains:

- the workflow as diagrams ([Mermaid](diagrams/openspec-workflow.mmd), horizontal in
  [Mermaid](diagrams/openspec-workflow-horizontal.mmd) and [PlantUML](diagrams/openspec-workflow-horizontal-plantuml.puml),
  each rendered to SVG and PNG),
- an agent skill, [`openspec-ticket-workflow`](skills/openspec-ticket-workflow/SKILL.md), that runs a ticket
  through the workflow and sets it up in a new project.
- [`openspec-dashboard`](tools/openspec-dashboard/README.md), a live local dashboard to follow the progress of the
  changes while agents work on them, with a backlog, charts from the git history and a chat with Claude Code
  (see [below](#the-dashboard)).
- two sample OpenSpec contexts, [`examples/todo-app`](examples/todo-app) and
  [`examples/habit-tracker`](examples/habit-tracker), and a short
  [user guide](docs/user-guide.md) with screenshots.

New here? Start with the [user guide](docs/user-guide.md).

## The workflow

```mermaid
%%{init: {"flowchart": {"subGraphTitleMargin": {"top": 4, "bottom": 10}}}}%%
flowchart TD
    %% Spec-driven ticket workflow with OpenSpec and AI agents (setup-independent)

    subgraph PLAN["Plan"]
        RM[("Roadmap<br/>order and dependencies")]
        BL[("Backlog<br/>draft proposals")]
        RM --- BL
    end

    BL ==>|"next ticket,<br/>prerequisites done"| SP

    subgraph SPECIFY["Specify"]
        SP["Turn the draft into a change, just in time<br/>design · spec deltas with scenarios<br/>tasks with acceptance criteria"]
    end

    subgraph BUILD["Build"]
        IM["Implement with tests<br/>tick each task once verified"]
        QG1{"Quality gate<br/>full build"}
    end

    subgraph ACCEPT["Accept"]
        AC{{"Acceptance check<br/>fresh agent, read-only<br/>every scenario and criterion has evidence"}}
        UP["Update spec and design<br/>to the accepted behaviour"]
    end

    subgraph REVIEW["Review"]
        RV{{"Review the diff<br/>fresh agent"}}
        VA{{"Validate the findings<br/>another fresh agent"}}
        FX["Fix high-value, low-effort findings"]
    end

    subgraph DOCUMENT["Document"]
        DO{{"Docs and diagrams<br/>fresh agents, only if affected"}}
        QG2{"Quality gate<br/>full build"}
    end

    subgraph CLOSE["Close"]
        AR["Archive the change<br/>one ticket = one commit"]
    end

    SPECS[("Living specs<br/>source of truth for the next change")]
    PL[("Parking lot<br/>deferred minors, known issues")]

    SP --> IM --> QG1
    QG1 -- red --> IM
    QG1 -- green --> AC
    AC -- "gap: fix now" --> IM
    AC -- "deviation: accept" --> UP --> AC
    AC -- done --> RV --> VA --> FX --> DO --> QG2
    QG2 -- red --> FX
    QG2 -- green --> AR
    AR ==> SPECS
    AR ==>|"next ticket"| BL

    FX -. "behaviour change:<br/>follow-up on the roadmap" .-> RM
    FX -. "minor" .-> PL
    AC -. "rest, by Pareto" .-> PL
    PL -. "triage every milestone" .-> BL

    classDef store fill:#eef0f7,stroke:#8d91aa,color:#23253f
    classDef step fill:#ffffff,stroke:#4f57d6,color:#23253f
    classDef gate fill:#fdf1e1,stroke:#e0861a,color:#23253f
    classDef agent fill:#ebecfc,stroke:#4f57d6,color:#23253f,stroke-dasharray:4 3
    classDef done fill:#e3f5ec,stroke:#1f9d68,color:#23253f
    class RM,BL,SPECS,PL store
    class SP,IM,UP,FX step
    class QG1,QG2 gate
    class AC,RV,VA,DO agent
    class AR done
    style PLAN fill:#f7f8fc,stroke:#c9cce0,color:#23253f
    style SPECIFY fill:#fbfbfe,stroke:#c9cce0,color:#23253f
    style BUILD fill:#fbfbfe,stroke:#c9cce0,color:#23253f
    style ACCEPT fill:#fbfbfe,stroke:#c9cce0,color:#23253f
    style REVIEW fill:#fbfbfe,stroke:#c9cce0,color:#23253f
    style DOCUMENT fill:#fbfbfe,stroke:#c9cce0,color:#23253f
    style CLOSE fill:#fbfbfe,stroke:#c9cce0,color:#23253f
```

Legend: rectangles are steps, diamonds are gates, dashed hexagons are fresh agents, cylinders carry work from one
ticket to the next. Dotted arrows show where deferred findings go.

Horizontal versions for slides and wide pages:
[Mermaid SVG](diagrams/openspec-workflow-horizontal.svg) ·
[Mermaid PNG](diagrams/openspec-workflow-horizontal.png) ·
[PlantUML SVG](diagrams/openspec-workflow-horizontal-plantuml.svg) ·
[PlantUML PNG](diagrams/openspec-workflow-horizontal-plantuml.png)

## Principles

- **One ticket = one OpenSpec change = one commit.** The change is archived in the commit that completes it, so
  the next change always builds on up-to-date specs.
- **Just in time.** Future work waits as short draft proposals in a backlog, ordered by a roadmap. Design, spec
  deltas and tasks are written when a ticket starts, with what earlier tickets taught you.
- **Every task says how it is verified.** Spec scenarios are the acceptance criteria; each task names its test,
  command or observable behaviour (`verify: …`).
- **Checks are done by fresh agents.** The agent that wrote the code does not accept, review or validate it.
  Review findings are confirmed by another agent before anyone acts on them.
- **Pareto.** Fix what is high value and low effort now. A behaviour change becomes a spec update plus a
  follow-up on the roadmap; minors go to a parking lot that is triaged at every milestone.
- **The gate never gets weaker.** No threshold is lowered to make a ticket pass.

## Steps and their OpenSpec support

| # | Phase | Step | OpenSpec |
|---|---|---|---|
| 1 | Specify | Create the change from its backlog draft; write design, spec deltas, tasks with `verify:` | `openspec new change`, `/openspec-continue-change`, `/openspec-ff-change`, `openspec validate` |
| 2 | Build | Implement with tests, tick each task once verified | `/openspec-apply-change` |
| 3 | Build | Quality gate | your build |
| 4 | Accept | Fresh agent checks every scenario and task criterion against evidence; deviations are recorded | `/openspec-verify-change`, `/openspec-update-change` |
| 5 | Review | Fresh agent reviews the staged diff only | any agent |
| 6 | Review | Another fresh agent confirms or rejects each finding, classifies pareto / minor | any agent |
| 7 | Review | Fix pareto findings; route the rest to spec + roadmap, backlog draft or parking lot | `/openspec-update-change` |
| 8 | Document | Fresh docs agent and diagram agent, only if docs are affected | any agent |
| 9 | Document | Quality gate | your build |
| 10 | Close | Archive the change and commit the ticket | `openspec archive`, `/openspec-archive-change` |

The slash commands are the agent skills that `openspec init` installs; names can differ between OpenSpec versions
and tools.

## Using the skill

Copy the skill into a project (or into your user-level skills directory):

```sh
cp -r skills/openspec-ticket-workflow <project>/.claude/skills/      # Claude Code, per project
cp -r skills/openspec-ticket-workflow ~/.claude/skills/              # Claude Code, all projects
```

Other agents that read [Agent Skills](https://agentskills.io) (`SKILL.md` with YAML front matter) can use the same
folder, e.g. under `.agents/skills/`.

Then ask the agent to set the workflow up ("set up the OpenSpec ticket workflow") or to run the next ticket. The
skill's references hold the pieces it uses:

- [config-snippet.yaml](skills/openspec-ticket-workflow/references/config-snippet.yaml): rules and guidance for
  `openspec/config.yaml`,
- [agent-prompts.md](skills/openspec-ticket-workflow/references/agent-prompts.md): prompts for the fresh agents
  (acceptance check, diff review, findings validation, docs, diagrams),
- [templates.md](skills/openspec-ticket-workflow/references/templates.md): roadmap, backlog draft and parking lot.

## The dashboard

A live, local dashboard for following agents (or a team) through the tickets: one Node script and one HTML page,
no dependencies, no build, no install.

```sh
cd <your project>
node <path-to>/tools/openspec-dashboard/server.mjs          # add --agent to talk to Claude Code from it
```

![OpenSpec dashboard on the todo-app sample](docs/images/dashboard-overview.png)

What makes it more than a status page:

- **Live from the files.** Status is derived from `openspec/` itself, not from a tracker that drifts: the change
  being worked on, its *current task* with the `verify:` criterion, when the last task was checked off and when a
  file was last written, so you can tell whether the agent is still busy. Updates within a second.
- **Board, backlog and focus.** A board in six columns derived from the files, a backlog per milestone like an
  issue tracker (reorder untouched tickets by drag and drop; the dashboard rewrites the roadmap and keeps every
  dependency number right), and a focus mode that hides what is archived.
- **From idea to ticket.** Add a ticket from the backlog, planned at the end of a milestone and ready to start, or
  keep it as an idea that needs refinement. **Brainstorm** an idea with Claude in the chat: it asks, challenges and
  checks the roadmap for overlaps, and the ticket is saved only if you agree with the result.
- **Charts from the git history.** Cumulative flow, a milestone burn-up with a forecast, the age of open work
  against the typical time, the cycle time of every change split into specify, implement and review, the
  dependency graph with the critical path, and when tasks get checked off. They are rebuilt from `git log` of
  `openspec/`, so they cover the whole project, not just the time the dashboard ran.
- **Talk to the agent** (`--agent`). A chat with a read-only project assistant, Claude Code sessions started on a
  ticket from the dashboard, and messages to a session that is already working, also one in a terminal (through
  a hook). It runs your local `claude` command with its own login: no API key, same plan.
- **Edit the specs from a conversation.** Every tab of a change (tasks, proposal, design, spec deltas, validation)
  has its own question box with that context. When the conversation finds something to change, Claude proposes
  the updated file; you see a diff and accept or reject it.
- **Quick replies in the chat.** React to an answer with one click (👍 ✅ 🙏 🎉 💡), ask for it again in simpler
  words (🔁), as a summary (📝) or as a table (📊), or quote it (↩, also just a selected part). Claude gets a short
  reference to the answer, so it knows what you mean without the answer being sent again; the chat stays quiet
  with just a faint ⋯ until you hover an answer.
- **Voice and rephrasing, locally.** Dictate into any text box with a local speech-to-text container, and let a
  local model turn a rough draft into a clear prompt. Nothing of it goes to the cloud, and nothing is sent until
  you send it.
- **Several projects** at once with a live overview, and **onboarding** right from it: it finds folders with a
  `CLAUDE.md` or `AGENTS.md`, lets you chat with Claude about whether one is worth it, and sets up OpenSpec there
  in the background (nothing committed). Or **start a new project**: brainstorm it with Claude, and once you agree
  it is created with its roadmap and followed from then on; an **expert mode** sets its quality gates, task checks,
  review topics, workflow steps, documentation, diagram format (Mermaid by default) and types, and container engine up front,
  and lets Claude check your local containers for a service to reuse (e.g. a running Postgres) before anything is
  installed on the host. Projects you are done with can be **archived** or **unfollowed**, so they cost nothing
  while they rest.
- **Join a session running in a terminal**: pick it from a list, follow what it does live (read-only by default),
  and write to it as if you typed there; it can even wait for your next message when it is done.
- **Git history** of the project: the commits with a graph of branches, tags and remote branches, and each commit's
  message, files and diff, read-only; **openspec/ only** shows just the commits that changed the specs.
- **Ten styles**, from Flat and Glass to Clay, Paper, Blackboard or a green-screen Terminal.

| Charts | Brainstorming an idea next to the backlog |
|---|---|
| ![Charts: cumulative flow, burn-up, cycle time, critical path](docs/images/dashboard-charts.png) | ![Brainstorming an idea in the chat, next to the backlog with its ideas](docs/images/dashboard-brainstorm.png) |

![Chat with the project assistant next to the full-screen board](docs/images/dashboard-chat.png)

Details: the [user guide](docs/user-guide.md) and the dashboard [README](tools/openspec-dashboard/README.md).

## Rendering the diagrams

The diagrams render in containers, so neither Node nor Java is needed:

```sh
./render-diagrams.sh
```

It uses `ghcr.io/mermaid-js/mermaid-cli/mermaid-cli` and `docker.io/plantuml/plantuml` with podman
(override with `MERMAID_IMAGE` / `PLANTUML_IMAGE`).

## License

[Apache License 2.0](LICENSE)
