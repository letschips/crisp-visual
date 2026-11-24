import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { extFromMime } from '../library/images.js';

/** Image files carried by a paste or drop event. */
export async function imagesFromTransfer(transfer) {
  const out = [];
  for (const file of Array.from(transfer?.files || [])) {
    const ext = extFromMime(file.type) || path.extname(file.name || '').slice(1).toLowerCase();
    if (!ext || !['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) continue;
    out.push({
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name ? path.basename(file.name, path.extname(file.name)) : '',
      ext: ext === 'jpeg' ? 'jpg' : ext
    });
  }
  return out;
}

export function transferHasImage(transfer) {
  return Array.from(transfer?.items || []).some(i => i.kind === 'file' && String(i.type).startsWith('image/'))
    || Array.from(transfer?.files || []).some(f => String(f.type).startsWith('image/'));
}

/** Reads an image from the system clipboard when there is no paste event (toolbar button, command). */
export async function readClipboardImage() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find(t => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        return { buffer: Buffer.from(await blob.arrayBuffer()), ext: extFromMime(type) || 'png' };
      }
    }
  } catch (e) {}

  try {
    const { clipboard } = require('electron');
    const img = clipboard?.readImage?.();
    if (img && !img.isEmpty()) return { buffer: img.toPNG(), ext: 'png' };
  } catch (e) {}

  if (process.platform === 'darwin') {
    const tmpFile = path.join(os.tmpdir(), `crisp-visual-clipboard-${process.pid}-${Date.now()}.png`);
    const script = `set f to open for access POSIX file "${tmpFile}" with write permission
set eof f to 0
write (the clipboard as «class PNGf») to f
close access f`;
    const ok = await new Promise(resolve => execFile('osascript', ['-e', script], { timeout: 5000 }, err => resolve(!err)));
    try {
      if (ok) {
        const buffer = await fs.promises.readFile(tmpFile);
        if (buffer.length > 100) return { buffer, ext: 'png' };
      }
    } catch (e) {
    } finally {
      fs.promises.rm(tmpFile, { force: true }).catch(() => {});
    }
  }
  return null;
}
