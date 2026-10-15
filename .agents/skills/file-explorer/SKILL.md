---
name: file-explorer
description: >-
  Use this skill when the user asks you to open a folder or file in Windows File Explorer, or highlight a specific file in its containing folder.
---

# File Explorer Skill

Output is one JSON line: `{"success": true, "path": "...", "action": "...", "message": "..."}` or `{"success": false, "error": "..."}` (exit code != 0).

## Commands (run from the repo root)

1. **Open a folder in File Explorer:**
   `python tools/file_explorer.py <folder_path>`
   e.g. `python tools/file_explorer.py Downloads` or `python tools/file_explorer.py "C:\\Users\\vanha\\Desktop"`

2. **Open folder and highlight/select a specific file:**
   `python tools/file_explorer.py <file_path> --select`
   e.g. `python tools/file_explorer.py package.json --select`

3. **Open a file with its default program:**
   `python tools/file_explorer.py <file_path> --action=open`

Supports standard shortcuts: `downloads`, `desktop`, `documents`, `pictures`, `videos`, `music`, `home`, `appdata`, `temp`, drive letters (`C:`, `D:`), and env vars (`%USERPROFILE%`, `~`).
