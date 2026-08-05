import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('./electron').filter(f => f.endsWith('.mjs'));
for (const file of files) {
  try {
    await import('./electron/' + file);
    console.log(file, 'OK');
  } catch(e) {
    console.log(file, 'ERROR', e.name, e.message);
  }
}
