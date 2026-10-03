---
name: sys-monitor
description: >-
  Use this skill when the user asks you to check system health, monitor battery, CPU, RAM, or disk usage.
---

# System Monitor Skill

You can check the health of the user's computer using the `sys_monitor.py` script.

## Command

Use the `run_command` tool to execute:
`python tools/sys_monitor.py`

This will output JSON data containing:
- CPU Usage (%)
- RAM Usage (%) and free/total space
- Disk Space C:\ (%)
- Battery Percentage (if it's a laptop)

Read the JSON output and then translate it into a friendly, human-readable report for the user. For example, if RAM is over 90%, warn the user that they might want to close some tabs!
