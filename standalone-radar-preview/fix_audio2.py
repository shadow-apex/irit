with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# remove all newlines
content = content.replace('\r', '').replace('\n', '')
content = content.replace('', '"')
if not content.endswith(';'):
    content += ';'
content = content + '\n'

with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
    f.write(content)
