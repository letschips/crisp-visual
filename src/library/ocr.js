// macOS Vision OCR. The helper ships inside main.js (BRAT and manual installs only get main.js,
// manifest.json and styles.css) and is written to the plugin folder when missing or outdated.
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import visionOcrBase64 from 'vision-ocr-binary';

let ensured = null;

export function ocrSupported() {
  return process.platform === 'darwin';
}

/** Makes sure the embedded helper is on disk at `target`. Resolves to the path, or null. */
export function ensureOcrBinary(target) {
  if (!ocrSupported() || !target) return Promise.resolve(null);
  if (ensured?.target === target) return ensured.promise;
  const promise = (async () => {
    const bytes = Buffer.from(visionOcrBase64, 'base64');
    const hash = data => crypto.createHash('sha256').update(data).digest('hex');
    let current = null;
    try { current = await fs.promises.readFile(target); } catch (e) {}
    if (!current || hash(current) !== hash(bytes)) {
      const temp = `${target}.${process.pid}.tmp`;
      await fs.promises.writeFile(temp, bytes, { mode: 0o755 });
      await fs.promises.rename(temp, target);
    }
    await fs.promises.chmod(target, 0o755);
    return target;
  })().catch(error => {
    console.warn('[Crisp Visual] OCR helper unavailable:', error);
    ensured = null;
    return null;
  });
  ensured = { target, promise };
  return promise;
}

/** Recognized text (Chinese + English), or '' when none was found. */
export function recognizeText(binary, imagePath, timeout = 20000) {
  return new Promise(resolve => {
    execFile(binary, [imagePath], { timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        console.warn('[Crisp Visual] OCR failed:', error.message);
        resolve('');
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}
