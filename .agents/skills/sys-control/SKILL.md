---
name: sys-control
description: >-
  Use this skill when the user asks you to control their system hardware or settings, such as turning on/off Wi-Fi, Bluetooth, Camera, adjusting volume, muting, or changing screen brightness.
---

# System Control Skill

Control the user's hardware via `tools/sys_control.py`. Output is one JSON line; a non-zero exit code means it failed.

- **Volume:** `--volume up|down|mute|unmute` (relative steps; `mute` is a Windows TOGGLE) or `--volume-level 0..100` (absolute).
- **Brightness:** `--brightness 50` — laptop panels only; external monitors report "not supported".
- **Wi-Fi:** `--wifi off` (disconnects). Turning it on is not automated — use `tools/wifi_manager.py connect "<SSID>"` for a saved network.
- **Bluetooth / Camera:** `--bluetooth on|off`, `--camera on|off`.

## Important
- Bluetooth/camera changes need Administrator rights: a UAC prompt appears and the script waits for the answer. Tell the user to click **Yes**.
- `--camera off` disables **every** camera device, including the webcam Iris itself uses for hand control and vision.
- Iris asks for a spoken two-step confirmation before these hardware toggles.
