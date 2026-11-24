import fs from 'fs';
import path from 'path';
import { visualEntitled } from '../license.js';
import { generateEagleId, resolveIngestFolders } from '../logic.js';
import { getOcrBinaryPath, normalizeEaglePath } from './paths.js';
import { buildItem, indexFolders, updateMetadata, writeJsonAtomic } from './eagle.js';
import { getImageDimensionsFromBuffer, sniffImageExt } from './images.js';
import { ensureOcrBinary, recognizeText } from './ocr.js';

const SCAN_CONCURRENCY = 24;

async function mapLimit(list, limit, fn) {
  const results = new Array(list.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await fn(list[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Reads an Eagle library (<name>.library/images/<id>.info/metadata.json). Scans are asynchronous
 * and incremental: an item is re-read only when its metadata.json or the folder tree changed.
 */
export class MediaScanner {
  constructor(plugin) {
    this.plugin = plugin;
    this.items = [];
    this.folders = [];
    this.folderMap = new Map();
    this.folderIndex = new Map();
    this.cache = new Map(); // info folder name -> { mtimeMs, folderStamp, item }
    this.folderStamp = '';
    this.scanId = 0;
  }

  rootPath() {
    return normalizeEaglePath(this.plugin.settings.mediaRoot || '');
  }

  async readFolderTree(rootPath) {
    const libMetaPath = path.join(path.resolve(rootPath, '..'), 'metadata.json');
    let stat = null;
    try { stat = await fs.promises.stat(libMetaPath); } catch (e) {}
    const stamp = stat ? String(stat.mtimeMs) : 'none';
    if (stamp === this.folderStamp) return;
    let tree = [];
    if (stat) {
      try {
        tree = JSON.parse(await fs.promises.readFile(libMetaPath, 'utf-8')).folders || [];
      } catch (e) {
        console.warn('[Crisp Visual] Failed to parse library metadata:', e);
      }
    }
    this.folders = Array.isArray(tree) ? tree : [];
    this.folderIndex = indexFolders(this.folders);
    this.folderMap = new Map([...this.folderIndex].map(([id, entry]) => [id, entry.node]));
    this.folderStamp = stamp;
  }

  async readItem(rootPath, dirName) {
    const infoDir = path.join(rootPath, dirName);
    const metaPath = path.join(infoDir, 'metadata.json');
    let stat;
    try { stat = await fs.promises.stat(metaPath); } catch (e) { return null; }
    const cached = this.cache.get(dirName);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.folderStamp === this.folderStamp) {
      return cached.item;
    }
    let item = null;
    try {
      const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
      if (!meta.isDeleted) {
        const files = await fs.promises.readdir(infoDir);
        item = buildItem({ infoDir, metaPath, meta, files, folders: this.folderIndex, version: Math.round(stat.mtimeMs) });
        if (item && !item.size) {
          try { item.size = (await fs.promises.stat(item.filePath)).size; } catch (e) {}
        }
      }
    } catch (err) {
      // Eagle may be writing this file right now; the watcher brings us back once it settles.
      console.warn(`[Crisp Visual] Skipped ${dirName}:`, err.message);
      return cached?.item || null;
    }
    this.cache.set(dirName, { mtimeMs: stat.mtimeMs, folderStamp: this.folderStamp, item });
    return item;
  }

  async scan() {
    if (!visualEntitled(this.plugin)) return [];
    const id = ++this.scanId;
    const rootPath = this.rootPath();
    let entries;
    try {
      entries = await fs.promises.readdir(rootPath, { withFileTypes: true });
    } catch (e) {
      if (rootPath) console.warn(`[Crisp Visual] Media root unavailable: ${rootPath}`);
      if (id === this.scanId) {
        this.items = [];
        this.cache.clear();
      }
      return [];
    }
    await this.readFolderTree(rootPath);
    const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name.endsWith('.info')).map(e => e.name);
    const items = await mapLimit(dirs, SCAN_CONCURRENCY, name => this.readItem(rootPath, name));
    if (id !== this.scanId) return this.items;
    const seen = new Set(dirs);
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key);
    this.items = items.filter(Boolean).sort((a, b) => b.mtime - a.mtime);
    return this.items;
  }

  ocrBinaryPath() {
    return getOcrBinaryPath(this.plugin.app, this.plugin.manifest?.dir);
  }

  async runOCR(item) {
    if (!visualEntitled(this.plugin)) return null;
    const binary = await ensureOcrBinary(this.ocrBinaryPath());
    if (!binary) return null;
    const text = await recognizeText(binary, item.filePath);
    if (!text) return '';
    if (!visualEntitled(this.plugin)) return null;
    try {
      const meta = await updateMetadata(item.metaPath, m => {
        m.ocrText = text;
        if (!m.annotation) m.annotation = text;
      });
      item.annotation = meta.annotation;
    } catch (e) {
      console.warn('[Crisp Visual] Could not save OCR text:', e);
    }
    item.ocrText = text;
    return text;
  }

  async updateItemStar(item, star) {
    if (!visualEntitled(this.plugin)) return false;
    try {
      await updateMetadata(item.metaPath, meta => { meta.star = star; });
      item.star = star;
      return true;
    } catch (e) {
      console.error('[Crisp Visual] Failed to update rating:', e);
      return false;
    }
  }

  /** Adds an image to the library as a new Eagle item. The extension follows the real bytes. */
  async ingestBuffer(buffer, name, folderId = null, ext = 'png') {
    // Guard the write boundary too: entitlement can be revoked while clipboard reads are pending.
    if (!visualEntitled(this.plugin)) {
      throw new Error('请先激活 Crisp Visual 后再导入素材');
    }
    const rootPath = this.rootPath();
    if (!rootPath || !fs.existsSync(rootPath)) throw new Error('还没有设置素材库');
    const realExt = sniffImageExt(buffer) || String(ext || 'png').toLowerCase();
    const id = generateEagleId();
    const infoDir = path.join(rootPath, `${id}.info`);
    await fs.promises.mkdir(infoDir, { recursive: true });

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fallback = `CAP-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeName = String(name || fallback).replace(/[\\/:*?"<>|]/g, '_').trim() || fallback;
    const mainFile = path.join(infoDir, `${safeName}.${realExt}`);
    const thumbFile = path.join(infoDir, `${safeName}_thumbnail.${realExt}`);

    await fs.promises.writeFile(mainFile, buffer);
    await fs.promises.writeFile(thumbFile, buffer);

    const dimensions = getImageDimensionsFromBuffer(buffer, realExt);
    const stamp = Date.now();
    const meta = {
      id,
      name: safeName,
      size: buffer.length,
      btime: stamp,
      mtime: stamp,
      ext: realExt,
      tags: name ? [] : ['clipboard'],
      folders: resolveIngestFolders(folderId, this.folderMap),
      isDeleted: false,
      url: '',
      annotation: '',
      modificationTime: stamp,
      height: dimensions.height || 0,
      width: dimensions.width || 0,
      star: 0,
      palettes: []
    };
    const metaPath = path.join(infoDir, 'metadata.json');
    await writeJsonAtomic(metaPath, meta);
    return { id, name: safeName, mainFile, metaPath };
  }
}

/** Watches the library and calls back (debounced) after Eagle or another app changes it. */
export class LibraryWatcher {
  constructor(plugin, onChange) {
    this.plugin = plugin;
    this.onChange = onChange;
    this.watchers = [];
    this.debounceTimer = null;
    this.root = '';
  }

  start() {
    const rootPath = normalizeEaglePath(this.plugin.settings.mediaRoot || '');
    if (this.watchers.length && rootPath === this.root) return;
    this.stop();
    if (!visualEntitled(this.plugin) || !rootPath || !fs.existsSync(rootPath)) return;
    this.root = rootPath;

    const trigger = (_event, filename) => {
      // Our own atomic-write temp files are not library changes.
      if (filename && String(filename).includes('.crisp-')) return;
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        this.onChange?.();
      }, 400);
    };

    try {
      this.watchers.push(fs.watch(rootPath, { recursive: true }, trigger));
      const libMeta = path.join(path.resolve(rootPath, '..'), 'metadata.json');
      if (fs.existsSync(libMeta)) this.watchers.push(fs.watch(libMeta, trigger));
    } catch (e) {
      console.warn('[Crisp Visual] File watcher error:', e);
    }
  }

  stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    for (const w of this.watchers) {
      try { w.close(); } catch (e) {}
    }
    this.watchers = [];
    this.root = '';
  }
}
