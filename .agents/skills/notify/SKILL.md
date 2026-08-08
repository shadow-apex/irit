---
name: notify
description: >-
  Use this skill when the user asks you to remind them of something, send them a notification, or pop up a message on their screen.
---

# Notification Skill

You can send native Windows Toast Notifications to the user's desktop to remind them of things or alert them.

## Command

Use the `run_command` tool to execute the `notifier.py` script:

`python tools/notifier.py --title "Your Title Here" --message "Your Message Here"`

This will immediately pop up a notification on their screen with the default system sound.
