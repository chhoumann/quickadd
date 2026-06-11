---
title: Global Variables
---

Global Variables let you define vault‑scoped, reusable snippets and reference them anywhere QuickAdd formatting is supported.

Use cases:
- Keep a single list of projects, tags, or folders and reuse it across choices and templates
- Centralize constants like paths, emojis, boilerplate text, or YAML blocks

Syntax
- Token: `{{GLOBAL_VAR:<name>}}`
- Matching is case‑insensitive in the token; the stored key is case‑sensitive
- Unresolved names resolve to an empty string

Where it works
- Template Choice: file name format, folder paths, template content
- Capture Choice: target path, content formatting
- Macros and inline formatting strings

Snippet content
- Snippet values can include any QuickAdd tokens, like `{{VALUE:...}}`, `{{VDATE:...}}`, `{{FIELD:...}}`, `{{RANDOM:n}}`, etc.
- Globals can reference other globals; nesting depth is limited (guarded at 5) to prevent cycles

How to set up
1) Open Settings → QuickAdd → Global Variables
2) Add a name and a value (free text). The value supports format tokens
3) Save happens automatically while typing

Tips
- Typing `{{GLOBAL_VAR:` will trigger suggestions, including your configured names
- Use descriptive names; avoid accidental duplicates differing only by case

Examples
```
Name: MyProjects
Value: {{VALUE:Inbox,Work,Personal,Archive}}

In a template path:
Projects/{{GLOBAL_VAR:MyProjects}}/{{DATE:YYYY}}/

In content:
- Project: {{GLOBAL_VAR:MyProjects}}
- Created: {{DATE:YYYY-MM-DD}}
```

Behavior details
- Globals expand early in the formatter so any tokens inside a snippet are processed by subsequent passes
- Preflight (one‑page inputs) scans inside global snippets and will collect any prompts those snippets introduce

