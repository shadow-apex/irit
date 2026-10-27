const fs = require('fs');
const content = fs.readFileSync('C:/Users/vanha/Downloads/irit-fixed-lan1/irit/src/components/SciFiScanReveal.tsx', 'utf8');
const match = content.match(/const AUDIO_SRC = "data:audio\/mp3;base64,[^"]+";/);
if (match) {
    fs.writeFileSync('C:/Users/vanha/Downloads/IritOriginalStartupApp/src/audio.ts', 'export ' + match[0] + '\n');
}
