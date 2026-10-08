import os

audio_file = r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio_src.txt'
with open(audio_file, 'r', encoding='utf-8') as f:
    audio_src_line = f.read().strip()

if ":" in audio_src_line:
    parts = audio_src_line.split("const AUDIO_SRC =", 1)
    if len(parts) == 2:
        audio_src_line = "export const AUDIO_SRC =" + parts[1]

with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
    f.write(audio_src_line)
