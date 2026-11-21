# Design

## Decisions

- Check-ins are stored per local date (`YYYY-MM-DD`); streaks are computed, never stored.
- A day without a check-in breaks the current streak only once the day is over.
