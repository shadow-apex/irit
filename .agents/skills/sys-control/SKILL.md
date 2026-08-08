---
name: sys-control
description: >-
  Use this skill when the user asks you to control their system hardware or settings, such as turning on/off Wi-Fi, Bluetooth, Camera, adjusting volume, muting, or changing screen brightness.
---

# System Control Skill

You have the ability to control the user's hardware and settings via the `tools/sys_control.py` script.

## Commands

Run the appropriate command using the `run_command` tool (WaitMsBeforeAsync=5000 is recommended so you can see if it worked).

- **Volume Control:** 
  `python tools/sys_control.py --volume mute` (or `up`, `down`)
  
- **Brightness Control:**
  `python tools/sys_control.py --brightness 50` (Replace 50 with any percentage from 0 to 100)
  
- **Wi-Fi Toggle:**
  `python tools/sys_control.py --wifi off` (or `on`)

- **Bluetooth Toggle:**
  `python tools/sys_control.py --bluetooth off` (or `on`)

- **Camera Toggle:**
  `python tools/sys_control.py --camera off` (or `on`)

## Important Note regarding Hardware Toggles
When you run commands to toggle Wi-Fi, Bluetooth, or Camera, a UAC (User Account Control) prompt will appear on the user's screen asking for Administrator privileges. You MUST tell the user to click "Yes" on that prompt for the action to succeed.
