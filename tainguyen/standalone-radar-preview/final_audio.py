import base64

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

start_marker = '"data:audio/mpeg;base64,'
if start_marker in content:
    idx = content.find(start_marker) + len(start_marker)
    end_idx = content.find('";', idx)
    b64_data = content[idx:end_idx].replace('\n', '').replace('\r', '').replace(' ', '')
    binary_data = base64.b64decode(b64_data)
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\public\audio.mp3', 'wb') as f:
        f.write(binary_data)
    print("SUCCESS! Wrote MP3 size:", len(binary_data))
else:
    print("Not found.")
