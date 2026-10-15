/* Genere les ressources graphiques de la version mobile a partir du logo
   detoure : icones de lanceur Android + logo embarque dans la WebView. */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'logo-mark.png');
const RES = path.join(ROOT, 'mobile', 'android', 'res');
const WWW = path.join(ROOT, 'mobile', 'www');

// Densites Android standard pour une icone de lanceur.
const MIPMAPS = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192]
];

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(SRC);
  if (src.isEmpty()) {
    console.error('logo-mark.png introuvable — lancez d\'abord tools/make-icons.js');
    app.exit(1);
    return;
  }

  MIPMAPS.forEach(([dir, size]) => {
    const target = path.join(RES, dir);
    fs.mkdirSync(target, { recursive: true });
    const img = src.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(target, 'ic_launcher.png'), img.toPNG());
  });
  console.log('icones de lanceur :', MIPMAPS.map((m) => m[1] + 'px').join(', '));

  // Logo affiche dans l'interface
  const ui = src.resize({ width: 192, height: 192, quality: 'best' });
  fs.writeFileSync(path.join(WWW, 'logo.png'), ui.toPNG());

  // Logo embarque en data URI : le rapport est imprime hors contexte de page,
  // les URL relatives n'y seraient pas resolues.
  const data = src.resize({ width: 160, height: 160, quality: 'best' }).toDataURL();
  fs.writeFileSync(path.join(WWW, 'logo-data.js'),
    '/* genere par tools/make-mobile-assets.js */\nwindow.DT_LOGO = ' + JSON.stringify(data) + ';\n', 'utf8');
  console.log('logo.png + logo-data.js (' + Math.round(data.length / 1024) + ' Ko)');

  app.quit();
});
