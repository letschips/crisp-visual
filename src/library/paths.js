import fs from 'fs';
import path from 'path';

function vaultBasePath(app) {
  const adapter = app?.vault?.adapter;
  return adapter?.basePath || (adapter?.getBasePath ? adapter.getBasePath() : '');
}

function findLibraryImages(dir) {
  try {
    if (!dir || !fs.existsSync(dir)) return '';
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.includes('.library')) continue;
      const candidate = path.join(dir, entry, 'images');
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch (e) {}
  return '';
}

/** Looks for an Eagle library (.library/images) in the vault, next to it, then in ~/Pictures. */
export function discoverEagleLibraryPath(app) {
  const vaultPath = vaultBasePath(app);
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const places = [vaultPath, vaultPath ? path.dirname(vaultPath) : '', home ? path.join(home, 'Pictures') : ''];
  for (const dir of places) {
    const found = findLibraryImages(dir);
    if (found) return found;
  }
  return '';
}

/**
 * Normalize user-provided or stored Eagle Library paths: terminal escapes (\ , \~), surrounding
 * quotes, tilde expansion, and a .library root completed to its /images folder.
 */
export function normalizeEaglePath(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let p = raw.trim();
  p = p.replace(/^["'“”‘’]|["'“”‘’]$/g, '').trim();

  if (p.startsWith('/') || p.startsWith('~')) {
    p = p.replace(/\\([ ~"'\(\)\[\]#&;$!*?<>|])/g, '$1');
  } else {
    p = p.replace(/\\([ ~])/g, '$1');
  }

  if (p.startsWith('~/') || p === '~') {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) p = path.join(home, p.slice(1));
  }

  if (p.length > 1 && (p.endsWith('/') || p.endsWith('\\'))) {
    p = p.slice(0, -1);
  }

  try {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      const candidateImages = path.join(p, 'images');
      if (fs.existsSync(candidateImages) && path.basename(p) !== 'images') p = candidateImages;
    }
  } catch (e) {}

  return p;
}

/** Where the OCR helper lives: the plugin folder under the vault's own config directory. */
export function getOcrBinaryPath(app, pluginDir = '') {
  const basePath = vaultBasePath(app);
  if (basePath) {
    const dir = pluginDir || path.join(app.vault.configDir || '.obsidian', 'plugins', 'crisp-visual');
    return path.join(basePath, dir, 'vision_ocr');
  }
  return null;
}

/**
 * file path -> URL the renderer can load directly. Obsidian's app:// protocol serves any local
 * file, so thumbnails stream from disk instead of being read into base64 strings.
 */
export function toResourceUrl(prefix, filePath, version) {
  if (!filePath) return '';
  let p = String(filePath).replace(/\\/g, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  const encoded = encodeURI(p).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const base = String(prefix || 'app://local/').replace(/\/+$/, '');
  return `${base}${encoded}${version ? `?${version}` : ''}`;
}
