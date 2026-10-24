---
'@kujam/core': patch
'@kujam/shapes': patch
---

Switching tools (toolbar, `V`, or any other shortcut) while placing a line no longer throws away the points placed so far: the line tool finishes the line (2 points or more) and selects it, as one undo step. Esc still drops the unfinished line.

In the tool runtime, the initial state's `onExit` of the tool being switched away from may now save unfinished work with `ctx.change`; the change is committed as its own undo step. Esc resets the tool's data before switching to the default tool, so nothing is saved then.
