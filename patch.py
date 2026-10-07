with open('electron/main/gemini-live.mjs', 'r', encoding='utf-8') as f:
    c = f.read()

c = c.replace('two!\"\",', 'two!\",')

with open('electron/main/gemini-live.mjs', 'w', encoding='utf-8') as f:
    f.write(c)
