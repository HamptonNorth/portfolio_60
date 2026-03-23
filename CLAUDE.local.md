# CLAUDE.local.md

Local development preferences and workflow rules for this repository.

## Code Style

- Always favour simple code that is easy to understand
- Always add JSDoc comments to all functions (`@param`, `@returns`, `@description`)
- Add inline comments where the logic is not self-evident
- Assume the project will be maintained by a developer with 1-2 years experience only

## Workflow

- Prepare commit messages for each feature — they will be manually committed/pushed to GitHub
- Unless the change is trivial, follow this sequence: ask clarifying questions, then plan, then get confirmation of plan before writing code
- If any instructions are not clear, **always** ask before proceeding
- If tests fail, **never move on until all tests pass**
- After completing a non-trivial feature (touching more than 2-3 files or adding new functionality), strongly remind me to commit before starting the next piece of work

## Environment

- **IDE**: Zed
- **Workstation**: Linux, latest Fedora Silverblue
- **Local server**: Ubuntu LTS, accessed publicly through Cloudflare tunnels
- **Locale**: UK (dates, spelling, currency)

## Library & Tooling Choices

- Favour long-term maintainability over fashion
- Prefer industry-standard open-source libraries by default
- When a new dependency is added, remind me to update the acknowledgements in the About page

## Acknowledgements

- Maintain a manual acknowledgements list of open-source software used, visible in the About UI
- Update when dependencies are added or removed
