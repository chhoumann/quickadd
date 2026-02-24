---
title: "Capture: Insert a Base Template into the Active File"
---

Use this pattern when you want QuickAdd to insert `.base` syntax into your
current note.

## Why this pattern

Capture does not write directly to `.base` files, but it can still pull content
from a `.base` template and insert that content into the active markdown note.

## Setup

1. Create a Capture choice.
2. Enable **Capture to active file**.
3. In **Capture format**, reference your `.base` template with an explicit file
   extension.

Example:

````markdown
## New Board Snippet

```base
{{TEMPLATE:Templates/Kanban Board.base}}
```

Note: {{VALUE}}
````

4. Run the Capture choice while the destination note is active.

QuickAdd will resolve the `.base` template and insert it into the active note.
