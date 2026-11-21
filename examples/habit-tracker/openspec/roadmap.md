# Roadmap — Habits

| Order | Change | Area | Depends on | Goal |
|---|---|---|---|---|
| 1 | `setup-foundation` | platform | — | SvelteKit skeleton with one `pnpm verify` gate. |
| 2 | `add-streaks` | habits | 1 | Daily check-ins and the current and longest streak per habit. |
| 3 | `add-reminders` | notifications | 2 | A daily reminder at a time the user chooses. |
| 4 | `add-statistics` | habits | 2 | Calendar heat map and completion rate per habit. |
| 5 | `add-export` | data | 2 | Export all habits and check-ins as CSV. |

## Milestones

- **M0 "First streak"** (1–2): a habit can be checked in daily and shows its streak.
- **M1 "Keep going"** (3–5): reminders, statistics and export.
