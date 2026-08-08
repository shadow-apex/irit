---
name: ai-vision
description: >-
  Use this skill when the user asks you to "look at the screen", "take a screenshot", or asks "what error is this?", "what am I looking at?", etc.
---

# AI Vision Skill

You have the ability to literally look at the user's screen by taking a screenshot and analyzing it.

## Steps

1. Run the `ai_vision.py` script located in `tools/` to take a screenshot.
   Command: `python tools/ai_vision.py --outdir ./` (Run it synchronously or WaitMsBeforeAsync=5000 so you can capture the output).
2. The script will output the absolute path to the saved screenshot image (e.g. `C:\...\screenshot_xxxx.png`).
3. Use your `view_file` tool and pass the absolute path of the image to read and analyze it.
4. Answer the user's question based on what you see in the screenshot!

Always tell the user what you see after analyzing the screenshot.
