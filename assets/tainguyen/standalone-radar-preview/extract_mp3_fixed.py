import base64

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8', errors='ignore')
marker = 'data:audio/mp3;base64,'
if marker in content:
    idx = content.find(marker) + len(marker)
    # find the end quote
    end_idx = content.find('"', idx)
    b64_data = content[idx:end_idx].replace('\\n', '').replace('\\r', '').replace(' ', '')
    binary_data = base64.b64decode(b64_data)
    
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\public\audio.mp3', 'wb') as f:
        f.write(binary_data)
    print("MP3 extracted to public/audio.mp3!")
else:
    print("Marker not found!")
