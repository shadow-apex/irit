---
name: clipboard
description: >-
  Use this skill when the user asks you to read what they copied (read clipboard) or save text/code into their clipboard so they can paste it later.
---

# Clipboard Skill

You can interact with the user's system clipboard using `clipboard_manager.py`.

## Commands

- **Read Clipboard:**
  `python tools/clipboard_manager.py --action read`
  Use this when the user says "what did I just copy?" or "read my clipboard". The tool will print the text.

- **Write to Clipboard:**
  `python tools/clipboard_manager.py --action write --text "your text here"`
  Use this when the user asks you to copy a long password, some code, or text into their clipboard so they can paste it elsewhere.
