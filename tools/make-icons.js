/* Detoure le logo : le PNG fourni est sur fond noir, illisible en theme clair
   et dans le rapport PDF imprime sur blanc. On derive l'alpha de la luminance
   et on de-premultiplie les couleurs. */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

function keyOut(img) {
  const { width, height } = img.getSize();
  const buf = Buffer.from(img.toBitmap());          // BGRA
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i], g = buf[i + 1], r = buf[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const a = Math.max(0, Math.min(255, Math.round(luma * 2.3)));
    if (a < 10) { buf[i] = buf[i + 1] = buf[i + 2] = buf[i + 3] = 0; continue; }
    buf[i] = Math.min(255, Math.round(b * 255 / a));
    buf[i + 1] = Math.min(255, Math.round(g * 255 / a));
    buf[i + 2] = Math.min(255, Math.round(r * 255 / a));
    buf[i + 3] = a;
  }
  return nativeImage.createFromBitmap(buf, { width, height });
}

app.whenReady().then(() => {
  const A = (f) => path.join(__dirname, '..', 'assets', f);
  const src = nativeImage.createFromPath(A('Logo.png'));
  console.log('source', JSON.stringify(src.getSize()));

  const mark = keyOut(src.crop({ x: 388, y: 6, width: 758, height: 758 }));
  fs.writeFileSync(A('logo-mark.png'), mark.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log('logo-mark.png ok');

  fs.writeFileSync(A('icon.png'), mark.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  console.log('icon.png ok');

  const full = keyOut(src);
  fs.writeFileSync(A('logo-full.png'), full.resize({ width: 640, quality: 'best' }).toPNG());
  console.log('logo-full.png ok');
  app.quit();
});
