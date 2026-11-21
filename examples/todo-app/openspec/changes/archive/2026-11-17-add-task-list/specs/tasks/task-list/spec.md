## ADDED Requirements

### Requirement: Create a todo
The system SHALL create a todo from a title of 1 to 200 characters after trimming. A new todo is not done.

#### Scenario: Valid title
- **WHEN** a user adds a todo with the title "Buy milk"
- **THEN** the todo appears at the top of the open todos

#### Scenario: Blank title
- **WHEN** a user adds a todo with a blank title
- **THEN** nothing is stored and the form shows "Enter a title"

### Requirement: Complete a todo
The system SHALL let a user mark a todo as done and as open again. Done todos are listed after open ones.

#### Scenario: Complete
- **WHEN** a user ticks an open todo
- **THEN** it moves below the open todos and is shown as done

### Requirement: Delete a todo
The system SHALL delete a todo permanently.

#### Scenario: Delete
- **WHEN** a user deletes a todo
- **THEN** it is no longer listed, also after a reload
