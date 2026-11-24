// Reading and writing Eagle's per-item metadata.json.
import fs from 'fs';
import path from 'path';
import { buildSearchText, classifyRGB, rgbToHex } from '../logic.js';

const MEDIA_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|avif|heic|pdf|mp4|mov)$/i;
const isThumbnail = f => path.basename(f, path.extname(f)).endsWith('_thumbnail');

/** Picks the original and thumbnail among an item folder's files (sidecars and dotfiles ignored). */
export function pickItemFiles(meta, files) {
  const visible = files.filter(f => !f.startsWith('.') && f !== 'metadata.json');
  const ext = String(meta.ext || '').replace(/^\./, '').toLowerCase();
  const originals = visible.filter(f => !isThumbnail(f));
  const original = originals.find(f => f === `${meta.name}.${ext}`)
    || originals.find(f => ext ? path.extname(f).slice(1).toLowerCase() === ext : MEDIA_EXT.test(f))
    || null;
  const thumbnail = visible.find(isThumbnail) || null;
  return { original, thumbnail };
}

/** Builds the gallery item for one Eagle .info folder. `folders` maps folder id -> { name, ancestors }. */
export function buildItem({ infoDir, metaPath, meta, files, folders, version }) {
  const { original, thumbnail } = pickItemFiles(meta, files);
  if (!original) return null;
  const filePath = path.join(infoDir, original);
  const ext = String(meta.ext || path.extname(original).slice(1)).replace(/^\./, '').toLowerCase();
  const id = meta.id || path.basename(infoDir).replace(/\.info$/, '');

  let primaryColorGroup = 'other';
  let primaryHex = '#888888';
  const first = Array.isArray(meta.palettes) ? meta.palettes[0] : null;
  if (first && Array.isArray(first.color) && first.color.length === 3) {
    primaryHex = rgbToHex(first.color[0], first.color[1], first.color[2]);
    primaryColorGroup = classifyRGB(first.color[0], first.color[1], first.color[2]);
  }

  const directFolders = Array.isArray(meta.folders) ? meta.folders : [];
  const allFolderIds = new Set();
  for (const fid of directFolders) {
    allFolderIds.add(fid);
    for (const ancestor of folders.get(fid)?.ancestors || []) allFolderIds.add(ancestor);
  }

  const item = {
    id,
    name: meta.name || path.basename(original, path.extname(original)),
    ext,
    size: meta.size || 0,
    width: meta.width || 0,
    height: meta.height || 0,
    filePath,
    thumbnailPath: thumbnail ? path.join(infoDir, thumbnail) : filePath,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    folders: directFolders,
    allFolderIds,
    foldersNamed: directFolders.map(fid => folders.get(fid)?.name || fid),
    annotation: meta.annotation || '',
    ocrText: meta.ocrText || meta.annotation || '',
    star: meta.star || 0,
    url: meta.url || '',
    mtime: meta.mtime || meta.modificationTime || 0,
    palettes: Array.isArray(meta.palettes) ? meta.palettes : [],
    primaryColorGroup,
    primaryHex,
    eagleUri: `eagle://item/${id}`,
    metaPath,
    version
  };
  item.searchText = buildSearchText(item);
  return item;
}

/** Flattens Eagle's folder tree into id -> { name, ancestors[] }. */
export function indexFolders(tree) {
  const map = new Map();
  const walk = (list, ancestors) => {
    for (const f of Array.isArray(list) ? list : []) {
      if (!f || !f.id) continue;
      map.set(f.id, { name: f.name, ancestors, node: f });
      walk(f.children, [f.id, ...ancestors]);
    }
  };
  walk(tree, []);
  return map;
}

/** Writes JSON next to the target and renames it into place, so Eagle never reads a half file. */
export async function writeJsonAtomic(filePath, data) {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.crisp-${process.pid}-${Date.now()}`);
  await fs.promises.writeFile(temp, JSON.stringify(data), 'utf-8');
  try {
    await fs.promises.rename(temp, filePath);
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** Re-reads metadata.json right before changing it, so edits Eagle made meanwhile survive. */
export async function updateMetadata(metaPath, mutate) {
  const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8'));
  mutate(meta);
  await writeJsonAtomic(metaPath, meta);
  return meta;
}
