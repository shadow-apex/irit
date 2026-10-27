import re, base64

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8', errors='ignore')
match = re.search(r'data:audio/mp3;base64,([A-Za-z0-9+/=\s]+)', content)

if match:
    b64_data = match.group(1).replace(' ', '').replace('\n', '').replace('\r', '').replace('\t', '')
    binary_data = base64.b64decode(b64_data)
    
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\public\audio.mp3', 'wb') as f:
        f.write(binary_data)
        
    print("MP3 extracted successfully!")
