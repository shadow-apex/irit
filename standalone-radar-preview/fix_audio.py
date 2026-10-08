with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('"', '')

with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'w', encoding='utf-8') as f:
    f.write(content)
