@AGENTS.md

## Superpowers Skills Usage

Not every user message requires invoking a Superpowers skill. Use skills for their intended purpose — implementation tasks, debugging, feature development, etc. Do NOT invoke brainstorming or other heavyweight skills for:

- Simple questions or clarifications
- Small, direct edits (e.g., "fix this typo", "add this line")
- File reads or codebase exploration
- Conversational replies

Use judgment. If the user asks a quick question or requests a straightforward change, just do it.

## Release Safety

**NEVER automatically install or launch a built release (Setup.exe, installer, etc.) on the local machine.** Running the installer kills all running ClaudeTerminal instances, terminating active sessions. Only build — let the user decide when to install.
