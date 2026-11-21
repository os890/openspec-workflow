# Demo project with history

`make-demo.mjs` builds a small OpenSpec project, "Team wiki", as a git repository with four weeks of history, so the
dashboard's charts have something to show: ten changes in three milestones, specified, worked through task by task
and archived on working days, one commit per step. M0 is done, M1 nearly (one change in progress), M2 is planned.
The dates are relative to the day you run it.

```sh
node examples/demo-history/make-demo.mjs ~/team-wiki-demo
node tools/openspec-dashboard/server.mjs ~/team-wiki-demo        # then: Charts
```

Zero dependencies; needs Node 20 and git. The project validates with `openspec validate --all`.
