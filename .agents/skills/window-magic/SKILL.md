---
name: window-magic
description: >-
  Use this skill when the user asks you to move a window on their screen, animate a window, or perform window magic.
---

# Window Magic Skill

You have the ability to move the user's windows on their screen using a custom Python script located at `tools/magic_move.py` within this repository.

## Commands

When the user asks you to move a window, run the appropriate command using the `run_command` tool (WaitMsBeforeAsync=0 for background execution).

1. **Move Active Window (Click to Move)**
   If the user wants to pick the window themselves, tell them they have 5 seconds to click on a window, and run:
   `python tools/magic_move.py --active -x <X> -y <Y>`

2. **Move Window By Name**
   If the user gives you a specific window name (e.g., "Chrome", "Zalo"):
   `python tools/magic_move.py --name "<Window Name>" -x <X> -y <Y>`

3. **Demo Mode**
   If the user asks for a demo, or to make the window dance/animate:
   `python tools/magic_move.py --demo`
   (Optionally, if they specify a name to demo, add `--name "<Name>"`)

4. **Demo Mode 2 (multi-window)**
   If the user asks for the "second demo" / a bigger demo / to open and arrange several windows at once, run:
   `python tools/magic_move.py --demo2`
   This opens 6 Notepad windows and arranges them in a 3x2 grid.

Always ensure you run these commands from the root directory of the workspace.
After running the command, let the user know what you did so they can observe their screen!
