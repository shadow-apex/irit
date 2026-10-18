import re

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

match = re.search(r'const AUDIO_SRC = "data:audio/mp3;base64,[^"]+";', content)
if match:
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
        f.write("export " + match.group(0) + "\n")
