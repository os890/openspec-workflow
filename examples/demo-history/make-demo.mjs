#!/usr/bin/env node
// A demo project with history, to try the dashboard's charts: "Team wiki", ten changes in three milestones, built
// up over the last four weeks as a git repository (one commit per step: drafts, specifying, ticking off tasks,
// archiving). M0 is done, M1 nearly (one change in progress), M2 is planned. The dates are relative to today.
//
//   node examples/demo-history/make-demo.mjs [<target folder>]      (default: ./team-wiki-demo)
//   node tools/openspec-dashboard/server.mjs <target folder>          then open Charts
//
// Zero dependencies; needs git. The target folder must not exist yet.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DST = path.resolve(process.argv[2] ?? 'team-wiki-demo');
if (fs.existsSync(DST)) { console.error(`${DST} exists already; pick another folder.`); process.exit(1); }

// ---- the project: ten changes; done ones get their tasks ticked off over a few working days
const CHANGES = [
  { name: 'setup-foundation', area: 'platform', cap: 'quality-gate', ms: 'M0', deps: '—', goal: 'Project skeleton with lint, tests, build and E2E behind one `pnpm verify`.',
    why: 'Every later ticket needs a build that checks itself. This change sets up the skeleton and its quality gate.',
    what: ['TypeScript monorepo with an API (Fastify) and a web app (React).', 'One `pnpm verify` runs lint, type check, tests with coverage, the build and the E2E suite.'],
    req: ['Quality gate', 'The project SHALL have one command that runs every check and fails when one fails.', [['Green build', 'a developer runs `pnpm verify` on a clean checkout', 'lint, type check, tests, build and E2E pass']]],
    tasks: [['Build', ['Workspace with api and web packages', 'pnpm install && pnpm build'], ['Lint and type check', 'pnpm lint && pnpm typecheck']], ['Tests', ['Vitest with coverage thresholds', 'pnpm test'], ['Playwright smoke test', 'pnpm e2e']], ['Gate', ['`pnpm verify` runs everything', 'pnpm verify is green']]] },
  { name: 'add-pages', area: 'pages', cap: 'pages', ms: 'M0', deps: '1', goal: 'Create and read wiki pages written in Markdown.',
    why: 'The first vertical slice: a team member writes a page and everyone can read it.',
    what: ['A page has a unique title and a Markdown body.', 'List of pages, a page view, a form to create a page.'],
    req: ['Create a page', 'The system SHALL create a page from a title of 1 to 120 characters and a Markdown body.', [['New page', 'a user creates the page "Onboarding"', 'it shows up in the list of pages'], ['Duplicate title', 'a page "Onboarding" exists and a user creates another one', 'the request is rejected with 409']]],
    tasks: [['Domain', ['Page entity with title and body', 'unit tests']], ['API', ['`POST /api/v1/pages` and `GET /api/v1/pages/{slug}`', 'API tests per scenario'], ['Migration `001_pages`', 'migration test']], ['Web', ['Page list and page view', 'component tests'], ['Create form', 'E2E "create a page"'], ['Markdown rendering without raw HTML', 'component test']]] },
  { name: 'add-editing', area: 'pages', cap: 'editing', ms: 'M1', deps: '2', goal: 'Edit pages; two people editing at once do not overwrite each other.',
    why: 'Pages go stale when nobody can fix them. Editing has to be safe when two people change the same page.',
    what: ['Edit title and body.', 'Optimistic locking: a stale save is rejected with the newer version shown.'],
    req: ['Edit a page', 'The system SHALL save a changed page only when it was based on the latest version.', [['Save', 'a user edits "Onboarding" and saves', 'the new text is shown'], ['Conflict', 'two users edit the same version and both save', 'the second save is rejected and shows the newer text']]],
    tasks: [['API', ['`PUT /api/v1/pages/{slug}` with a version', 'API tests'], ['409 with the current version on a conflict', 'API test "Conflict"']], ['Web', ['Edit form with preview', 'component test'], ['Conflict dialog', 'E2E "conflict"']], ['Docs', ['README: editing and conflicts', 'review']]] },
  { name: 'add-links', area: 'pages', cap: 'links', ms: 'M1', deps: '2', goal: 'Links between pages with [[Title]]; missing pages are marked.',
    why: 'A wiki lives from links. Writing them should be as easy as typing the title.',
    what: ['`[[Title]]` links to the page with that title.', 'A link to a missing page is shown in another colour and offers to create it.'],
    req: ['Page links', 'The system SHALL render `[[Title]]` as a link to the page with that title.', [['Existing page', 'a page contains [[Onboarding]] and that page exists', 'the text links to it'], ['Missing page', 'the page does not exist', 'the link is marked as missing']]],
    tasks: [['Rendering', ['`[[Title]]` in the Markdown renderer', 'unit tests'], ['Missing links marked', 'component test']], ['Web', ['"Create this page" from a missing link', 'E2E "follow a missing link"'], ['Backlinks on each page', 'component test']]] },
  { name: 'add-search', area: 'search', cap: 'search', ms: 'M1', deps: '2', goal: 'Full-text search over titles and bodies.',
    why: 'With more than a few dozen pages, people find pages by searching, not by browsing.',
    what: ['Search box in the header.', 'SQLite FTS5 index over title and body, ranked results with a snippet.'],
    req: ['Search', 'The system SHALL find pages whose title or body contains all search words, title matches first.', [['Title match first', 'pages "Deploy" and "Notes about deploy" exist and a user searches "deploy"', '"Deploy" comes first'], ['No match', 'nothing matches', 'the result says so']]],
    tasks: [['Index', ['FTS5 table kept current by triggers', 'migration test'], ['Ranking: title before body', 'unit test']], ['API', ['`GET /api/v1/search?q=`', 'API tests per scenario']], ['Web', ['Search box and result list with snippets', 'E2E "search"'], ['Empty state', 'component test']]] },
  { name: 'add-page-history', area: 'history', cap: 'page-history', ms: 'M1', deps: '3', goal: 'Every saved version is kept; any two can be compared and one restored.',
    why: 'Editing is only relaxed when a mistake can be undone.',
    what: ['Each save stores a version with author and time.', 'History view with a diff between two versions and "restore".'],
    req: ['Page history', 'The system SHALL keep every saved version of a page and restore one as a new version.', [['Restore', 'a user restores the version from yesterday', 'it becomes the newest version and the history keeps all others']]],
    tasks: [['Domain', ['Version table and repository', 'unit tests']], ['API', ['`GET /api/v1/pages/{slug}/versions`', 'API test'], ['Restore endpoint', 'API test "Restore"']], ['Web', ['History list and diff view', 'component tests'], ['Restore with confirmation', 'E2E "restore"']]] },
  { name: 'add-tags', area: 'tags', cap: 'tags', ms: 'M1', deps: '2', goal: 'Tag pages and filter the page list by tag.',
    why: 'Pages about the same topic are spread over the wiki; tags group them without a fixed hierarchy.',
    what: ['A page has 0 to 10 tags.', 'The page list can be filtered by one or more tags.'],
    req: ['Tags', 'The system SHALL let a user add up to 10 tags to a page and filter the page list by tags.', [['Filter', 'two pages are tagged "ops"', 'filtering by "ops" shows exactly these two']]],
    tasks: [['API', ['Tags on create and update', 'API tests'], ['Filter by tags', 'API test "Filter"']], ['Web', ['Tag input with suggestions', 'component test'], ['Tag filter in the list', 'E2E "filter by tag"']]] },
  { name: 'add-accounts', area: 'access', cap: 'accounts', ms: 'M2', deps: '1', goal: 'Sign-up and login; every change records who made it.',
    why: 'So far everyone is anonymous. Comments and permissions need to know who someone is.',
    what: ['E-mail and password with a session cookie.', 'Versions and pages record their author.'] },
  { name: 'add-comments', area: 'comments', cap: 'comments', ms: 'M2', deps: '8', goal: 'Comment on a page; the author is notified.',
    why: 'Discussions about a page end up in chat and get lost.', what: ['Comments under a page, newest last.', 'The page author gets an e-mail on a new comment.'] },
  { name: 'add-permissions', area: 'access', cap: 'permissions', ms: 'M2', deps: '8', goal: 'Read-only pages and private spaces.',
    why: 'Some pages must not be changed by everyone, and some are for one team only.', what: ['A page can be locked by its author.', 'Spaces with members; pages in a space are only visible to them.'] },
];
const MILESTONES = [['M0', 'Walking skeleton', '1–2', 'the build, its gates and the first vertical slice'], ['M1', 'Usable wiki', '3–7', 'everything a team needs to write and find pages'], ['M2', 'Team', '8–10', 'accounts, comments and permissions']];

// ---- the calendar: working days, the last one today
const days = [];
for (let d = new Date(); days.length < 20; d = new Date(d.getTime() - 86400e3)) if (d.getDay() % 6) days.unshift(new Date(d));
const at = (day, hm) => { const [h, m] = hm.split(':').map(Number); const d = new Date(days[day]); d.setHours(h, m, 0, 0); return d; };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// [change index, specify day, ticks per day (one commit per tick), archive day] — the in-progress change has no archive day
const PLAN = [[0, 0, [2, 3], 2], [1, 2, [2, 2, 2], 4], [2, 5, [1, 2, 2], 8], [3, 7, [2, 2], 9], [4, 9, [1, 2, 2], 12], [5, 12, [2, 1, 2], 16], [6, 17, [1, 1], null]];
const SPECIFIED_ONLY = [7]; // add-accounts: specified at the end, nothing ticked yet

// ---- files
const W = (rel, text) => { const p = path.join(DST, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const RM = (rel) => fs.rmSync(path.join(DST, rel), { recursive: true, force: true });
const git = (args, when) => execFileSync('git', ['-C', DST, ...args], { stdio: 'ignore', env: { ...process.env, ...(when ? { GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() } : {}) } });
const commit = (msg, when) => { git(['add', '-A']); git(['commit', '-q', '-m', msg], when); };

const proposal = (c) => `# Proposal\n\n## Why\n\n${c.why}\n\n## What Changes\n\n${c.what.map((w) => `- ${w}`).join('\n')}\n\n## Capabilities\n\n### New Capabilities\n- \`${c.area}/${c.cap}\`: ${c.goal}\n`;
const requirement = (c) => `### Requirement: ${c.req[0]}\n${c.req[1]}\n\n${c.req[2].map(([n, w, t]) => `#### Scenario: ${n}\n- **WHEN** ${w}\n- **THEN** ${t}`).join('\n\n')}\n`;
const delta = (c) => `## ADDED Requirements\n\n${requirement(c)}`;
const mainSpec = (c) => `# ${c.area}/${c.cap} Specification\n\n## Purpose\n${c.goal}\n\n## Requirements\n\n${requirement(c)}`;
const taskLines = (c) => c.tasks.flatMap(([, ...items], g) => items.map(([t, v], i) => ({ id: `${g + 1}.${i + 1}`, t, v })));
const tasksMd = (c, done) => `# Tasks\n\n${c.tasks.map(([group, ...items], g) => `## ${g + 1}. ${group}\n\n${items.map(([t, v], i) => {
  const k = taskLines(c).findIndex((x) => x.id === `${g + 1}.${i + 1}`);
  return `- [${k < done ? 'x' : ' '}] ${g + 1}.${i + 1} ${t}; verify: ${v}`;
}).join('\n')}`).join('\n\n')}\n`;
const roadmap = () => `# Roadmap — Team wiki\n\nOne OpenSpec change per row, in implementation order. A change exists only as a draft in \`openspec/backlog/\`\nuntil its work starts. "Depends on" lists hard prerequisites (row numbers).\n\n| Order | Change | Area | Depends on | Goal |\n|---|---|---|---|---|\n${CHANGES.map((c, i) => `| ${i + 1} | \`${c.name}\` | ${c.area} | ${c.deps} | ${c.goal} |`).join('\n')}\n\n## Milestones\n\n${MILESTONES.map(([id, t, rows, what]) => `- **${id} "${t}"** (${rows}): ${what}.`).join('\n')}\n\n## Candidates (not yet planned)\n\n- Page templates (found while specifying \`add-pages\`).\n- Export a space as static HTML.\n`;
const config = `schema: spec-driven\n\ncontext: |\n  Product: "Team wiki" - a small wiki for one team: Markdown pages, links, search and history.\n\n  Stack: TypeScript, Node.js 22, Fastify, SQLite, React 19 with Vite. pnpm only.\n  Tests: Vitest (unit, component, API), Playwright (E2E).\n\n  Quality gate: \`pnpm verify\` runs lint, type check, tests with coverage thresholds, the build and the E2E suite.\n\n  Delivery: one OpenSpec change = one ticket = one commit. Deferred findings go to the change \`parking-lot\`.\n`;

// ---- the code a ticked task leaves behind (for Charts › Code): a module, its tests, a migration, a component with
// styles, or docs, of a size that comes from the task (the same every run); a coverage report at the end
const STOP = new Set(['and', 'the', 'a', 'an', 'with', 'on', 'of', 'by', 'to', 'in', 'per', 'from', 'for', 'each', 'without', 'kept', 'api', 'v1']);
const camel = (t) => t.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => /^[a-z]/i.test(w) && !STOP.has(w.toLowerCase())).slice(0, 3)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'step';
const size = (t, lo, hi) => lo + ([...t].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 9973, 7) % (hi - lo));
function tsModule(name, n, area) {
  const T = name[0].toUpperCase() + name.slice(1), out = [`// ${T}: part of the ${area} feature`, `import { db, type Row } from '../db.js';`, '', `export interface ${T} {`, '  id: number;', '  slug: string;', '  updatedAt: string;', '}', ''];
  if (n > 60) out.push('// TODO: paginate once a space has more than a few hundred pages', '');
  for (let i = 0; out.length < n; i++) out.push(`export function ${name}${i ? i + 1 : ''}(input: Partial<${T}>): ${T} {`, `  const row = db.prepare('SELECT * FROM ${area} WHERE slug = ?').get(input.slug) as Row | undefined;`, `  if (!row) throw new Error('not found: ' + input.slug);`, `  return { id: row.id, slug: row.slug, updatedAt: new Date().toISOString() };`, '}', '');
  return out.join('\n') + '\n';
}
function tsTest(name, n) {
  const out = [`import { describe, expect, it } from 'vitest';`, `import { ${name} } from '../src/${name}.js';`, '', `describe('${name}', () => {`];
  for (let i = 0; out.length < n - 1; i++) out.push(`  it('case ${i + 1}', () => {`, `    const r = ${name}({ slug: 'page-${i + 1}' });`, `    expect(r.slug).toBe('page-${i + 1}');`, '  });', '');
  out.push('});');
  return out.join('\n') + '\n';
}
function tsxComponent(name, n) {
  const C = name[0].toUpperCase() + name.slice(1), out = [`import { useState } from 'react';`, `import './${name}.css';`, '', `export function ${C}({ slug }: { slug: string }) {`, '  const [open, setOpen] = useState(false);', '  return ('];
  for (let i = 0; out.length < n - 3; i++) out.push(`    <section className="${name}-${i}" onClick={() => setOpen(!open)}>`, `      <h2>{slug} {open ? '▾' : '▸'}</h2>`, '    </section>');
  out.push('  );', '}');
  return out.join('\n') + '\n';
}
const css = (name, n) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => `.${name}-${i} {\n  padding: ${4 + i}px;\n  border-bottom: 1px solid #e5e7eb;\n}`).join('\n') + '\n';
const doc = (title, n) => `# ${title}\n\n` + Array.from({ length: n }, (_, i) => (i % 5 === 4 ? '' : `Step ${i + 1}: how the wiki handles ${title.toLowerCase()}, with an example.`)).join('\n') + '\n';
function codeFor(c, task) {
  const group = c.tasks.find(([, ...items]) => items.some(([t]) => t === task.t))?.[0] ?? '', name = camel(task.t), n = (lo, hi) => size(task.t, lo, hi);
  if (/^Docs/.test(group) || /README/.test(task.t)) W(`docs/${c.area}-${name}.md`, doc(task.t.replace(/`/g, ''), n(14, 34)));
  else if (/Migration/.test(task.t)) W(`packages/api/migrations/${c.area}-${name}.sql`, `-- ${task.t.replace(/`/g, '')}\nCREATE TABLE IF NOT EXISTS ${c.area} (\n  id INTEGER PRIMARY KEY,\n  slug TEXT NOT NULL UNIQUE,\n  body TEXT NOT NULL,\n  updated_at TEXT NOT NULL\n);\nCREATE INDEX IF NOT EXISTS ${c.area}_slug ON ${c.area}(slug);\n`);
  else if (/^Web/.test(group)) { W(`packages/web/src/${c.area}/${name}.tsx`, tsxComponent(name, n(30, 80))); W(`packages/web/src/${c.area}/${name}.css`, css(name, n(8, 24))); W(`packages/web/test/${name}.test.tsx`, tsTest(name, n(16, 40))); }
  else if (/^Tests/.test(group)) W(/Playwright/.test(task.t) ? `e2e/${name}.spec.ts` : `packages/api/test/${name}.test.ts`, tsTest(name, n(20, 50)));
  else if (/^(Build|Lint|Gate)/.test(group) || /verify/.test(task.t)) W(`scripts/${name}.sh`, `#!/bin/sh\n# ${task.t.replace(/`/g, '')}\nset -e\npnpm -r lint\npnpm -r typecheck\npnpm -r test -- --coverage\npnpm -r build\n`);
  else { W(`packages/api/src/${c.area}/${name}.ts`, tsModule(name, n(25, 75), c.area)); W(`packages/api/test/${name}.test.ts`, tsTest(name, n(18, 48))); }
}

// ---- the history
fs.mkdirSync(DST, { recursive: true });
git(['init', '-q']); git(['config', 'user.name', 'Demo']); git(['config', 'user.email', 'demo@example.invalid']);
W('README.md', '# Team wiki (demo)\n\nA demo project for the OpenSpec dashboard: four weeks of history in `openspec/`.\n');
W('openspec/config.yaml', config); W('openspec/roadmap.md', roadmap());
W('.gitignore', 'node_modules/\ncoverage/\ndist/\n');
W('package.json', JSON.stringify({ name: 'team-wiki', private: true, scripts: { verify: 'sh scripts/verify.sh' }, devDependencies: { typescript: '5.8.3', vitest: '3.2.4' } }, null, 2) + '\n');
for (const c of CHANGES) W(`openspec/backlog/${c.name}.md`, proposal(c));
W('openspec/changes/parking-lot/proposal.md', '# Proposal\n\n## Why\n\nA place for deferred findings, known issues and trade-offs, so they are not lost between tickets.\n\n## What Changes\n\n- Collects deferred items as tasks; it is never archived.\n');
W('openspec/changes/parking-lot/.openspec.yaml', `schema: spec-driven\ncreated: ${ymd(days[0])}\nskip_specs: true\n`);
W('openspec/changes/parking-lot/tasks.md', '# Tasks\n\nParking lot for deferred items. It is never archived; triage it at every milestone.\n\n## 1. Review minors\n\n- [ ] 1.1 [review-minor] Two date formats in the API — origin: add-pages; done when: one format, tests adjusted\n\n## 2. Known issues\n\n- [ ] 2.1 [known-issue] Search snippets cut words in half — origin: add-search; done when: snippets end at word boundaries\n');
commit('chore(openspec): roadmap, ticket drafts and the parking lot', at(0, '09:05'));

const steps = [];
// the ticks of a day at different times between 9:45 and 17:30 (the same every run), in order
const tickTimes = (i, j, k) => Array.from({ length: k }, (_, t) => 585 + ((i * 97 + j * 61 + t * 131 + t * t * 17) % 465)).sort((a, b) => a - b)
  .map((m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
for (const [i, sday, ticks, aday] of PLAN) {
  const c = CHANGES[i], n = taskLines(c).length;
  steps.push([at(sday, '09:30'), `chore(openspec): specify ${c.name}`, () => {
    RM(`openspec/backlog/${c.name}.md`);
    W(`openspec/changes/${c.name}/.openspec.yaml`, `schema: spec-driven\ncreated: ${ymd(days[sday])}\n`);
    W(`openspec/changes/${c.name}/proposal.md`, proposal(c));
    W(`openspec/changes/${c.name}/tasks.md`, tasksMd(c, 0));
    W(`openspec/changes/${c.name}/specs/${c.area}/${c.cap}/spec.md`, delta(c));
  }]);
  let done = 0;
  ticks.forEach((k, j) => {
    const times = tickTimes(i, j, k);
    for (let t = 0; t < k && done < n; t++) {
      const upto = ++done;
      steps.push([at(sday + j, times[t]), `feat(${c.area}): ${taskLines(c)[upto - 1].t.replace(/`/g, '')}`, () => { W(`openspec/changes/${c.name}/tasks.md`, tasksMd(c, upto)); codeFor(c, taskLines(c)[upto - 1]); }]);
    }
  });
  if (aday != null) {
    const finish = done;
    steps.push([at(aday, '17:45'), `chore(openspec): archive ${c.name}`, () => { // at the end of the day, after its last ticks
      RM(`openspec/changes/${c.name}`);
      const dir = `openspec/changes/archive/${ymd(days[aday])}-${c.name}`;
      W(`${dir}/.openspec.yaml`, `schema: spec-driven\ncreated: ${ymd(days[sday])}\n`);
      W(`${dir}/proposal.md`, proposal(c)); W(`${dir}/tasks.md`, tasksMd(c, Math.max(finish, n)));
      W(`${dir}/specs/${c.area}/${c.cap}/spec.md`, delta(c));
      W(`openspec/specs/${c.area}/${c.cap}/spec.md`, mainSpec(c));
      W(`docs/${c.cap}.md`, doc(c.goal.replace(/[`.;].*$/, ''), size(c.name, 18, 44))); // the user docs of the feature
    }]);
  }
}
for (const i of SPECIFIED_ONLY) {
  const c = CHANGES[i];
  c.req = ['Sign-up and login', 'The system SHALL let a person sign up with an e-mail address and a password and log in with them.', [['Login', 'a user logs in with the right password', 'they see the wiki under their name']]];
  c.tasks = [['API', ['Users table and password hashing', 'unit tests'], ['Session login and logout', 'API tests']], ['Web', ['Sign-up and login pages', 'E2E "sign up and log in"']]];
  steps.push([at(19, '14:20'), `chore(openspec): specify ${c.name}`, () => {
    RM(`openspec/backlog/${c.name}.md`);
    W(`openspec/changes/${c.name}/.openspec.yaml`, `schema: spec-driven\ncreated: ${ymd(days[19])}\n`);
    W(`openspec/changes/${c.name}/proposal.md`, proposal(c)); W(`openspec/changes/${c.name}/tasks.md`, tasksMd(c, 0));
    W(`openspec/changes/${c.name}/specs/${c.area}/${c.cap}/spec.md`, delta(c));
  }]);
}
steps.sort((a, b) => a[0] - b[0]);
const now = Date.now();
for (const [when, msg, run] of steps) { if (when.getTime() > now) continue; run(); commit(msg, when); }
// what the last test run left (not committed: coverage/ is ignored)
W('coverage/coverage-summary.json', JSON.stringify({ total: { lines: { total: 2140, covered: 1871, skipped: 0, pct: 87.43 } } }) + '\n');
console.log(`Created ${DST}: ${steps.length + 1} commits over ${days.length} working days.\nTry: node <path-to>/tools/openspec-dashboard/server.mjs ${DST}`);
