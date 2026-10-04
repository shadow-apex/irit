---
name: ai-vision
description: >-
  Use this skill when the user asks you to "look at the screen", "take a screenshot", or asks "what error is this?", "what am I looking at?", etc.
---

# AI Vision Skill

Iris captures the screen **inside the Electron app** (not with a Python script): the Gemini Live tool
`take_ai_screenshot` grabs the primary monitor, downscales it to <= 1280x720 and sends it straight to the
model as an image frame. The image is saved to disk only when the tool is called with `save: true`
(`<userData>/screenshots/screenshot_*.jpg`, keeping at most 20 files / 24 h).

## When you are the Gemini Live assistant
1. Call `take_ai_screenshot` (add `save: true` only if the user wants to keep it).
2. Describe what you see. The result includes `frame_geometry`; if you then click something you read off the image, call
   `mouse_control` with `space: "frame"` so Iris converts the downscaled coordinates to real screen pixels.
3. `view_image` only shows *saved* screenshots to the **user** (floating window) — it does not give you the image.

## When you are Claude Code
There is no screenshot script. If the user already saved screenshots, read the newest file in the Iris user-data
`screenshots` folder with your file-viewing tool; otherwise ask the user to say "take a screenshot" to Iris (voice) or to share the image.
