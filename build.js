#!/usr/bin/env node
'use strict';

/**
 * Decidio build script.
 *
 *   node build.js                 # build both targets + regenerate Xcode project
 *   node build.js --chrome        # Chrome only
 *   node build.js --safari        # Safari only
 *   node build.js --safari --skip-convert   # write dist-safari, don't touch Xcode
 *   node build.js --strict        # treat unreachable-file warnings as errors
 *
 * Requires Node 16.7+ (uses fs.cpSync).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config — edit these, not the code below.
// ---------------------------------------------------------------------------

const CONFIG = {
  srcDir: 'src',
  chromeOut: 'dist-chrome',
  safariOut: 'dist-safari',
  safariProject: 'safari-project',

  appName: 'Decidio',
  bundleId: 'com.decidio.extension',

  // Your Flask backend. Injected into Safari's permissions so fetches from
  // background.js aren't blocked. Set to null to skip.
  localServer: 'http://localhost:5000/*',

  // Files that are legitimately not reachable from the manifest (e.g. loaded
  // dynamically at runtime). Listed here so they stop showing up as warnings.
  allowUnreferenced: ['README.md'],
};

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const buildChrome = has('--chrome') || !has('--safari');
const buildSafari = has('--safari') || !has('--chrome');
const skipConvert = has('--skip-convert');
const strict = has('--strict');

const ROOT = process.cwd();
const SRC = path.join(ROOT, CONFIG.srcDir);

let warningCount = 0;

const log = (...m) => console.log(...m);
const ok = (...m) => console.log('  \x1b[32m✓\x1b[0m', ...m);
const warn = (...m) => { warningCount++; console.log('  \x1b[33m!\x1b[0m', ...m); };
const fail = (msg) => { console.error('\n\x1b[31m✗ ' + msg + '\x1b[0m\n'); process.exit(1); };

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/** Every file under dir, as posix-style paths relative to dir. */
function listFiles(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === '.DS_Store') continue;
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * macOS filesystems are case-insensitive but the Xcode build and Safari's
 * resource loader are not. `logo.png` resolving on your Mac does not mean it
 * resolves in the packaged extension. This compares against real directory
 * entries so `active_logo.PNG` vs `active_logo.png` gets caught here.
 */
function existsExactCase(relPath) {
  const parts = relPath.split('/');
  let dir = SRC;
  for (let i = 0; i < parts.length; i++) {
    let entries;
    try { entries = fs.readdirSync(dir); } catch { return false; }
    if (!entries.includes(parts[i])) return false;
    dir = path.join(dir, parts[i]);
  }
  return true;
}

function rimraf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Build the reachability graph: which files does the manifest actually pull in?
// ---------------------------------------------------------------------------

function manifestRoots(manifest) {
  const roots = [];
  const push = (v) => { if (typeof v === 'string' && !/^(https?:)?\/\//.test(v)) roots.push(v); };

  const bg = manifest.background || {};
  push(bg.service_worker);
  push(bg.page);
  (bg.scripts || []).forEach(push);

  for (const cs of manifest.content_scripts || []) {
    (cs.js || []).forEach(push);
    (cs.css || []).forEach(push);
  }

  const action = manifest.action || manifest.browser_action || manifest.page_action || {};
  push(action.default_popup);
  if (typeof action.default_icon === 'string') push(action.default_icon);
  else Object.values(action.default_icon || {}).forEach(push);

  Object.values(manifest.icons || {}).forEach(push);

  push(manifest.options_page);
  push((manifest.options_ui || {}).page);
  push((manifest.devtools_page));
  Object.values(manifest.chrome_url_overrides || {}).forEach(push);

  for (const war of manifest.web_accessible_resources || []) {
    if (typeof war === 'string') push(war);
    else (war.resources || []).forEach(push);
  }

  return roots;
}

/** Pull local dependencies out of an HTML or JS file. */
function scanDeps(relPath) {
  const abs = path.join(SRC, relPath);
  let text;
  try { text = fs.readFileSync(abs, 'utf8'); } catch { return []; }

  const dir = path.posix.dirname(relPath);
  const found = new Set();
  const add = (ref) => {
    if (!ref || /^(https?:|data:|#|mailto:)/.test(ref)) return;
    const resolved = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, ref));
    if (!resolved.startsWith('..')) found.add(resolved);
  };

  if (/\.html?$/i.test(relPath)) {
    for (const m of text.matchAll(/<script[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
    for (const m of text.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
    for (const m of text.matchAll(/<img[^>]+src\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  } else if (/\.js$/i.test(relPath)) {
    // static imports, dynamic imports, service-worker importScripts
    for (const m of text.matchAll(/\bimport\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g)) add(m[1]);
    for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
    for (const m of text.matchAll(/importScripts\s*\(([^)]*)\)/g)) {
      for (const s of m[1].matchAll(/["']([^"']+)["']/g)) add(s[1]);
    }
  } else if (/\.css$/i.test(relPath)) {
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  }

  return [...found];
}

function validate(manifest) {
  log('\nValidating src/ …');

  const seen = new Set();
  const missing = [];
  const queue = manifestRoots(manifest);

  while (queue.length) {
    const ref = queue.shift();
    if (seen.has(ref)) continue;
    seen.add(ref);

    if (!existsExactCase(ref)) { missing.push(ref); continue; }
    for (const dep of scanDeps(ref)) if (!seen.has(dep)) queue.push(dep);
  }

  if (missing.length) {
    for (const m of missing) console.error('  \x1b[31m✗\x1b[0m referenced but missing (or wrong case): ' + m);
    fail(`${missing.length} referenced file(s) not found in ${CONFIG.srcDir}/. ` +
         'These will silently not be copied into the Xcode project.');
  }
  ok(`${seen.size} referenced files all present`);

  const onDisk = listFiles(SRC);
  const orphans = onDisk.filter((f) =>
    !seen.has(f) &&
    !CONFIG.allowUnreferenced.includes(f) &&
    f !== 'manifest.json' &&
    /\.(js|css|html|png|jpg|jpeg|svg|json)$/i.test(f)
  );

  if (orphans.length) {
    warn('unreachable from manifest.json — these will NOT reach Safari:');
    for (const f of orphans) console.log('      ' + f);
    console.log('      → add to the manifest, import them from a reached file,');
    console.log('        or list them in CONFIG.allowUnreferenced');
    if (strict) fail('--strict: unreachable files present');
  } else {
    ok('no unreachable files');
  }
}

// ---------------------------------------------------------------------------
// Safari manifest transform
// ---------------------------------------------------------------------------

function toSafariManifest(input) {
  const m = JSON.parse(JSON.stringify(input));

  // Safari rejects names with trailing punctuation/whitespace, and the failure
  // presents as the extension simply never appearing in Settings → Extensions.
  if (typeof m.name === 'string') {
    const cleaned = m.name.trim().replace(/[.\s]+$/, '');
    if (cleaned !== m.name) {
      warn(`name "${m.name}" → "${cleaned}" (trailing characters break Safari)`);
      m.name = cleaned;
    }
  }

  // Chrome Web Store fields Safari doesn't understand.
  for (const k of ['key', 'update_url', 'minimum_chrome_version', 'offline_enabled']) {
    if (k in m) { delete m[k]; warn(`removed Chrome-only key: ${k}`); }
  }

  if (m.background) {
    // MV2: `persistent` is Chrome-specific and Safari errors on it.
    if ('persistent' in m.background) {
      delete m.background.persistent;
      warn('removed background.persistent (MV2 Chrome-only)');
    }
    // MV3: service workers need Safari 16.4+.
    if (m.background.service_worker) {
      log('  \x1b[36mi\x1b[0m background.service_worker requires Safari 16.4+.');
      log('      On older Safari, swap to: "background": { "scripts": ["background.js"] }');
    }
  }

  // Safari enforces host permissions strictly; localhost must be declared or
  // every fetch to the Flask server fails in the background console.
  if (CONFIG.localServer) {
    const key = m.manifest_version === 3 ? 'host_permissions' : 'permissions';
    m[key] = m[key] || [];
    if (!m[key].includes(CONFIG.localServer)) {
      m[key].push(CONFIG.localServer);
      ok(`added ${CONFIG.localServer} to ${key}`);
    }
  }

  return m;
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

function copyTree(dest) {
  rimraf(dest);
  fs.cpSync(SRC, dest, { recursive: true });
  fs.rmSync(path.join(dest, '.DS_Store'), { force: true });
}

function buildChromeTarget(manifest) {
  log('\nBuilding Chrome →', CONFIG.chromeOut);
  copyTree(path.join(ROOT, CONFIG.chromeOut));
  fs.writeFileSync(
    path.join(ROOT, CONFIG.chromeOut, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  ok('done');
}

function buildSafariTarget(manifest) {
  log('\nBuilding Safari →', CONFIG.safariOut);
  const out = path.join(ROOT, CONFIG.safariOut);
  copyTree(out);

  const safariManifest = toSafariManifest(manifest);
  fs.writeFileSync(
    path.join(out, 'manifest.json'),
    JSON.stringify(safariManifest, null, 2) + '\n'
  );
  ok('manifest transformed');

  if (skipConvert) {
    log('  (--skip-convert: leaving Xcode project untouched)');
    return;
  }

  try {
    execSync('xcrun --find safari-web-extension-converter', { stdio: 'ignore' });
  } catch {
    fail('safari-web-extension-converter not found.\n' +
         '  Install full Xcode, then: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer');
  }

  log('\nRunning safari-web-extension-converter …');
  const cmd = [
    'xcrun safari-web-extension-converter',
    `"${CONFIG.safariOut}"`,
    `--project-location "${CONFIG.safariProject}"`,
    `--app-name "${CONFIG.appName}"`,
    `--bundle-identifier "${CONFIG.bundleId}"`,
    '--macos-only',
    '--copy-resources',
    '--no-open',
    '--no-prompt',
    '--force',
  ].join(' ');

  try {
    execSync(cmd, { stdio: 'inherit', cwd: ROOT });
  } catch {
    fail('Converter failed. Read its output above — it names the offending manifest key.');
  }
  ok('Xcode project regenerated');
}

// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(SRC)) fail(`No ${CONFIG.srcDir}/ directory found. Run this from the repo root.`);

  const manifestPath = path.join(SRC, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`No ${CONFIG.srcDir}/manifest.json`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    fail('manifest.json is not valid JSON: ' + e.message);
  }

  log(`\n${CONFIG.appName} build — manifest v${manifest.manifest_version || 2}`);

  validate(manifest);

  if (buildChrome) buildChromeTarget(manifest);
  if (buildSafari) buildSafariTarget(manifest);

  log(`\nDone${warningCount ? ` with ${warningCount} warning(s)` : ''}.`);

  if (buildSafari && !skipConvert) {
    log('\nNext:');
    log(`  1. open ${CONFIG.safariProject}/${CONFIG.appName}/${CONFIG.appName}.xcodeproj`);
    log('  2. Build & Run (⌘R)');
    log('  3. Safari → Develop → Allow Unsigned Extensions  (resets on quit)');
    log('  4. Safari → Settings → Extensions → enable, then set site access to Allow');
    log('  5. Errors live in Develop → Web Extension Background Content\n');
  }
}

main();