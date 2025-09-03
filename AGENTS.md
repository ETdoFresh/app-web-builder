# Agent Guidelines

## Coding Principles

- Concise changes: Make minimal, focused diffs that directly address the request.
- Clean code: Favor readability over cleverness; match existing style and patterns.
- Scope discipline: Do not refactor or fix unrelated code.
- Keep structure: Avoid renames/moves unless necessary or requested.
- No inline comments unless explicitly requested by the user.
- Update docs when behavior or usage changes.
- Avoid adding new dependencies unless required by the task.

## Running Commands

- Never automatically run `npm install`, `npm start`, or `npm run dev`.
- Always instruct the user which command(s) to run and in which directory.
- If validation requires running a script, provide clear steps instead of executing it yourself.
- Call out environment prerequisites succinctly (Node version, env vars) and let the user run the commands.

## Git Commit Message Rules

### Format

Subject Line [Required]

- Detail Line 1 [Optional]
- Detail Line 2 [Optional]
- ...

### Rules
- Use imperative mood
- Present active tense
- Start with a capital letter
- Start with a verb (Add, Update, Remove, Fix, etc)
- Does not include prefix [fix:, feat:, chore:, refactor:, etc]
- Rules apply to subject line and detail lines
- Does not require details, but if change is larger, include it
- Do not include  characters

### Examples

#### Example 1

Update API POST endpoint to support dynamic paths and improve URL construction

#### Example 2

Rename PlayerController to CharacterController for clarity and consistency

#### Example 3

Move PlayerController to CharacterController for better organization

#### Example 4

Remove unused assets and clean up project structure

#### Example 5

Enhance ColyseusManager and GameRoom for improved room management and connection handling.

- Update ColyseusManager to utilize roomCode from Discord API or URL query parameters for dynamic room joining.
- Modify GameRoom to store and log roomCode in metadata for better matchmaking and debugging.
- Ensure fallback behavior for roomCode when not provided, enhancing user experience during connection attempts.

#### Example 6

Add UICanvas prefab and metadata for UI layout management

- Introduce UICanvas prefab to manage the user interface layout.

#### Example 7

Refactor PlayerController and CharacterCreatorUI to streamline character appearance updates.

- Introduce UpdateColyseusCharacterAppearance method in PlayerController for better code organization.
- Update CharacterCreatorUI to call the new method after saving character options, ensuring consistent state updates across the application.
