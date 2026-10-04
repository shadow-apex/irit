---
name: window-magic
description: >-
  Use this skill when the user asks you to move a window on their screen or resize it.
---

# Window Magic Skill

Windows are moved with Win32 calls (ctypes) — no PowerShell. Iris's own window is never targeted.
Every script prints one JSON line (`success`, `message`/`error`) and exits non-zero on failure.

## Commands (run from the repo root)

1. **Move the window the user focuses** (the script really counts down, then moves the focused window):
   `python tools/magic_move.py --active --wait 5 -x <X> -y <Y>`
   Tell the user right away: "click the window you want to move — you have 5 seconds".
2. **Move by name** (exact exe name like `chrome`, otherwise a title fragment of >= 4 characters):
   `python tools/magic_move.py --name "<Window Name>" -x <X> -y <Y>`
3. **Move + resize precisely:**
   `python tools/move_window.py "<Window Name>" <X> <Y> --width <W> --height <H>`

A `--demo` animation exists only for developers (`IRIS_DEV_TOOLS=1`).
Negative coordinates are valid (monitors left of / above the primary one).
