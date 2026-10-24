---
'@kujam/renderer': patch
---

A drag, selection box, or click no longer rolls back when a macOS trackpad reports a move with no button down before the release (Chromium then drops the pointer capture before `pointerup`). A lost capture or buttonless mouse move with no button pressed now ends the gesture as a release; a capture lost while a button is still down still cancels.
