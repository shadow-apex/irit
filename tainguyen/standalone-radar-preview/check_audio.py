with open(r'C:\Users\vanha\Downloads\IritOriginalStartupApp\src\audio.ts', 'r', encoding='utf-8') as f:
    content = f.read()

print("Length:", len(content))
print("Start:", content[:100])
print("End:", content[-100:])
