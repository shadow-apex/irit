import re

with open(r'C:\Users\vanha\Downloads\irit-fixed-lan1\irit\src\components\SciFiScanReveal.tsx', 'rb') as f:
    raw = f.read()

content = raw.decode('utf-8', errors='ignore')
match = re.search(r'data:audio/mp3;base64,[A-Za-z0-9+/=\s]+', content)

if match:
    clean_b64 = match.group(0).replace(' ', '').replace('\n', '').replace('\r', '').replace('\t', '')
    
    # split into chunks of 10000 chars
    chunk_size = 10000
    chunks = [clean_b64[i:i+chunk_size] for i in range(0, len(clean_b64), chunk_size)]
    
    out = "export const AUDIO_SRC = \n"
    for i, chunk in enumerate(chunks):
        out += f'"{chunk}"'
        if i < len(chunks) - 1:
            out += ' +\n'
        else:
            out += ';\n'
            
    with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
        f.write(out)
