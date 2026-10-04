---
name: clipboard
description: >-
  Use this skill when the user asks you to read what they copied (read clipboard) or save text/code into their clipboard so they can paste it later.
---

# Clipboard Skill

Output is one JSON line: `{"success": true, "text": "..."}` or `{"success": false, "error": "..."}` (exit code != 0).

- **Read:** `python tools/clipboard_manager.py --action read`
- **Write (short text):** `python tools/clipboard_manager.py --action write --text=<text>`
- **Write (long or sensitive text — keeps it out of the command line):** pipe it in:
  `python tools/clipboard_manager.py --action write --stdin`

Clipboard **history** (`tools/clipboard_history.py`) is OFF by default for privacy: the user must set
`IRIS_CLIPBOARD_HISTORY=1`. It keeps ~10 minutes / 20 entries and skips anything that looks like a password, OTP or card number.
