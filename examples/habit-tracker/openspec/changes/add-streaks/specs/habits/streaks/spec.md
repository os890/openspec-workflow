## ADDED Requirements

### Requirement: Daily check-in
The system SHALL record at most one check-in per habit and local date, and SHALL let the user undo it on the same day.

#### Scenario: Check in
- **WHEN** a user checks in "Read 20 pages" today
- **THEN** the habit shows as done for today

#### Scenario: Undo
- **WHEN** the user undoes today's check-in
- **THEN** the habit shows as open again

### Requirement: Streaks
The current streak SHALL be the number of consecutive days with a check-in ending today or yesterday; the longest
streak SHALL be the maximum of all such runs.

#### Scenario: Gap
- **WHEN** a habit was checked in on Nov 1, 2, 3 and 5, and today is Nov 5
- **THEN** the current streak is 1 and the longest streak is 3
