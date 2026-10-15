/* =========================================================================
   DonTrack — construction de l'APK Android sans Gradle.

   Enchaine directement les outils du SDK :
     aapt2 compile/link  →  javac  →  d8  →  zip  →  zipalign  →  apksigner

   Aucune dependance reseau : tout vient du SDK deja installe.
   Usage : node tools/build-apk.js
   ========================================================================= */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const BUILD = path.join(ROOT, 'build', 'apk');
const DIST = path.join(ROOT, 'dist');

const APP_ID = 'com.dontrack.app';
const VERSION_NAME = '1.0.0';
const VERSION_CODE = '1';
const MIN_SDK = '24';
const TARGET_SDK = '35';

/* ------------------------------------------------------------ localisation */

function firstExisting(list, label) {
  for (const p of list) if (p && fs.existsSync(p)) return p;
  throw new Error(`Introuvable : ${label}\nCherche dans :\n  ` + list.join('\n  '));
}

const SDK = firstExisting([
  process.env.ANDROID_SDK_ROOT,
  process.env.ANDROID_HOME,
  path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  path.join(os.homedir(), 'Android', 'Sdk')
], 'SDK Android');

function pickVersioned(dir, preferred) {
  const items = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());
  for (const p of preferred) if (items.includes(p)) return p;
  // sinon la plus recente par ordre numerique
  return items.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
}

const BT_VERSION = pickVersioned(path.join(SDK, 'build-tools'), ['35.0.0', '36.0.0', '34.0.0']);
const BT = path.join(SDK, 'build-tools', BT_VERSION);
const PLATFORM = pickVersioned(path.join(SDK, 'platforms'), ['android-35', 'android-36', 'android-34']);
const ANDROID_JAR = path.join(SDK, 'platforms', PLATFORM, 'android.jar');

const JAVA_HOME = firstExisting([
  process.env.JAVA_HOME,
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  'C:\\Program Files\\Android\\Android Studio\\jre',
  path.join(SDK, '..', 'jbr')
], 'JDK');

const JAVAC = path.join(JAVA_HOME, 'bin', 'javac.exe');
const KEYTOOL = path.join(JAVA_HOME, 'bin', 'keytool.exe');
const AAPT2 = path.join(BT, 'aapt2.exe');
const D8 = path.join(BT, 'd8.bat');
const ZIPALIGN = path.join(BT, 'zipalign.exe');
const APKSIGNER = path.join(BT, 'apksigner.bat');

/* ------------------------------------------------------------ utilitaires */

const log = (msg) => console.log('  • ' + msg);

function run(exe, args, opts) {
  const isBat = /\.bat$/i.test(exe);
  const cmd = isBat ? process.env.ComSpec || 'cmd.exe' : exe;
  const argv = isBat ? ['/d', '/s', '/c', exe].concat(args) : args;
  // d8.bat et apksigner.bat exigent JAVA_HOME : on l'impose au sous-processus.
  const env = Object.assign({}, process.env, { JAVA_HOME });
  return execFileSync(cmd, argv, Object.assign({ stdio: 'pipe', encoding: 'utf8', env }, opts || {}));
}

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst, filter) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d, filter);
    else if (!filter || filter(name)) fs.copyFileSync(s, d);
  }
}

/** Ajoute un fichier dans un zip existant via .NET (dispo sur toute machine Windows). */
function addToZip(zipPath, filePath, entryName) {
  const ps = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `$z=[System.IO.Compression.ZipFile]::Open('${zipPath.replace(/'/g, "''")}','Update');`,
    `$e=$z.GetEntry('${entryName}'); if($e){$e.Delete()}`,
    `[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,'${filePath.replace(/'/g, "''")}','${entryName}',[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null;`,
    '$z.Dispose()'
  ].join(' ');
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe' });
}

/* ------------------------------------------------------------ etapes */

function stageAssets() {
  const assets = path.join(BUILD, 'assets');
  rimraf(assets);
  fs.mkdirSync(assets, { recursive: true });

  // Interface mobile
  copyDir(path.join(MOBILE, 'www'), assets);

  // Noyau partage avec la version desktop
  for (const f of ['core.js', 'charts.js', 'report.js']) {
    fs.copyFileSync(path.join(ROOT, 'src', 'shared', f), path.join(assets, f));
  }

  const files = fs.readdirSync(assets);
  for (const must of ['index.html', 'app.js', 'core.js', 'charts.js', 'report.js', 'logo.png', 'logo-data.js']) {
    if (!files.includes(must)) throw new Error(`assets/${must} manquant — lancez d'abord make-mobile-assets.js`);
  }
  log(`assets : ${files.length} fichiers`);
  return assets;
}

function linkResources(assetsDir) {
  const res = path.join(MOBILE, 'android', 'res');
  const flata = path.join(BUILD, 'res.flata');
  const baseApk = path.join(BUILD, 'base.apk');

  run(AAPT2, ['compile', '--dir', res, '-o', flata]);
  log('ressources compilees');

  run(AAPT2, [
    'link',
    '-o', baseApk,
    '-I', ANDROID_JAR,
    '--manifest', path.join(MOBILE, 'android', 'AndroidManifest.xml'),
    '-A', assetsDir,
    '--min-sdk-version', MIN_SDK,
    '--target-sdk-version', TARGET_SDK,
    '--version-code', VERSION_CODE,
    '--version-name', VERSION_NAME,
    '--auto-add-overlay',
    flata
  ]);
  log(`APK de base lie (compileSdk ${PLATFORM})`);
  return baseApk;
}

function compileJava() {
  const classes = path.join(BUILD, 'classes');
  rimraf(classes);
  fs.mkdirSync(classes, { recursive: true });

  const srcDir = path.join(MOBILE, 'android', 'java');
  const sources = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.java')) sources.push(p);
    }
  })(srcDir);

  run(JAVAC, [
    '-source', '8', '-target', '8',
    '-nowarn', '-Xlint:-options',
    '-encoding', 'UTF-8',
    '-classpath', ANDROID_JAR,
    '-d', classes
  ].concat(sources));
  log(`java compile : ${sources.length} fichier(s)`);

  const dexDir = path.join(BUILD, 'dex');
  rimraf(dexDir);
  fs.mkdirSync(dexDir, { recursive: true });

  const classFiles = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (n.endsWith('.class')) classFiles.push(p);
    }
  })(classes);

  run(D8, ['--release', '--min-api', MIN_SDK, '--lib', ANDROID_JAR, '--output', dexDir].concat(classFiles));
  log('dex genere');
  return path.join(dexDir, 'classes.dex');
}

function keystore() {
  const dir = path.join(MOBILE, 'signing');
  const ks = path.join(dir, 'dontrack.keystore');
  if (fs.existsSync(ks)) return ks;

  fs.mkdirSync(dir, { recursive: true });
  run(KEYTOOL, [
    '-genkeypair', '-v',
    '-keystore', ks,
    '-alias', 'dontrack',
    '-keyalg', 'RSA', '-keysize', '2048',
    '-validity', '10000',
    '-storepass', 'dontrack', '-keypass', 'dontrack',
    '-dname', 'CN=DonTrack, OU=Application, O=DonTrack, C=FR'
  ]);
  log('cle de signature creee (a conserver pour les mises a jour)');
  return ks;
}

/* ------------------------------------------------------------ main */

function main() {
  console.log(`\nDonTrack — construction de l'APK`);
  console.log(`  SDK ............ ${SDK}`);
  console.log(`  build-tools .... ${BT_VERSION}`);
  console.log(`  plateforme ..... ${PLATFORM}`);
  console.log(`  JDK ............ ${JAVA_HOME}\n`);

  rimraf(BUILD);
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  const assets = stageAssets();
  const baseApk = linkResources(assets);
  const dex = compileJava();

  addToZip(baseApk, dex, 'classes.dex');
  log('dex insere dans l\'APK');

  const aligned = path.join(BUILD, 'aligned.apk');
  run(ZIPALIGN, ['-p', '-f', '4', baseApk, aligned]);
  log('aligne sur 4 octets');

  const out = path.join(DIST, `DonTrack-${VERSION_NAME}.apk`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  run(APKSIGNER, [
    'sign',
    '--ks', keystore(),
    '--ks-pass', 'pass:dontrack',
    '--key-pass', 'pass:dontrack',
    '--v1-signing-enabled', 'true',
    '--v2-signing-enabled', 'true',
    '--out', out,
    aligned
  ]);
  log('signe');

  const verify = run(APKSIGNER, ['verify', '--print-certs', out]);
  const ok = /Verifies/i.test(verify) || verify.includes('Signer #1');
  const size = (fs.statSync(out).size / 1024 / 1024).toFixed(1);

  console.log(`\n  APK : ${out}`);
  console.log(`  Taille : ${size} Mo · signature ${ok ? 'valide' : 'A VERIFIER'}`);
  console.log(`  Installation : copier le fichier sur le telephone et l'ouvrir.\n`);
}

try {
  main();
} catch (err) {
  console.error('\nECHEC :', err.message);
  if (err.stdout) console.error(String(err.stdout));
  if (err.stderr) console.error(String(err.stderr));
  process.exit(1);
}
