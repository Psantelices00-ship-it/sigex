#!/usr/bin/env node
/** Asegura spa/eng.traineddata en ./tessdata (Railway / local). */
const fs = require('fs');
const path = require('path');
const https = require('https');
const dir = path.join(__dirname, '..', 'tessdata');
const files = {
  'spa.traineddata': 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/spa.traineddata',
  'eng.traineddata': 'https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata',
};
function get(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'sigex' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlinkSync(dest);
        return get(res.headers.location, dest).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    }).on('error', reject);
  });
}
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, url] of Object.entries(files)) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) {
      console.log('ok', name);
      continue;
    }
    console.log('download', name);
    await get(url, dest);
    console.log('saved', name, fs.statSync(dest).size);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
