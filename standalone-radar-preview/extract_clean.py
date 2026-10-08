import re

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the AUDIO_SRC line
match = re.search(r'const AUDIO_SRC = "(data:audio/mp3;base64,[^"]+)";', content)
if match:
    base64_data = match.group(1).replace('\n', '').replace('\r', '').replace(' ', '')
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
        f.write('export const AUDIO_SRC = "' + base64_data + '";\n')
