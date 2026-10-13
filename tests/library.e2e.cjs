// Real filesystem integration: ingestion -> scanning -> Markdown linking -> live watching.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

const source = path.resolve(process.env.VISUAL_SOURCE || path.join(__dirname, '..', 'main.js'));
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === 'obsidian') {
    class Base {}
    return { Plugin: Base, ItemView: Base, Modal: Base, PluginSettingTab: Base, Notice: Base };
  }
  return originalLoad.call(this, name, ...args);
};
const mod = new Module(source, module);
mod.filename = source;
mod.paths = Module._nodeModulePaths(path.dirname(source));
try {
  mod._compile(fs.readFileSync(source, 'utf8') + '\nmodule.exports.LibraryWatcher = LibraryWatcher;', source);
} finally { Module._load = originalLoad; }
const Plugin = mod.exports;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-library-e2e-'));
const root = path.join(temp, '中文 素材.library', 'images');
fs.mkdirSync(root, { recursive: true });
const plugin = { settings: { mediaRoot: root }, licenseManager: { isEntitled: () => true } };
const scanner = new Plugin.classes.MediaScanner(plugin);
const report = { source, fixture: temp, scenarios: [] };
async function check(name, fn) {
  try { await fn(); report.scenarios.push({ name, passed: true }); }
  catch (error) { report.scenarios.push({ name, passed: false, error: error.message }); }
}
(async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64');
  const asset = await scanner.ingestBuffer(png, '真实 原图');
  fs.writeFileSync(path.join(path.dirname(asset.mainFile), '000-sidecar.txt'), 'not an image');
  await check('sidecar cannot replace original image or Markdown target', async () => {
    const items = await scanner.scan();
    assert.equal(items[0].filePath, asset.mainFile);
    assert.ok(Plugin.logic.buildInsertSyntax(items[0], 'standard_markdown').includes('%E7%9C%9F'));
  });
  await check('renamed Eagle metadata still resolves original media by extension', async () => {
    const meta = JSON.parse(fs.readFileSync(asset.metaPath));
    meta.name = 'Eagle renamed title';
    fs.writeFileSync(asset.metaPath, JSON.stringify(meta));
    assert.equal((await scanner.scan())[0].filePath, asset.mainFile);
  });
  await check('Eagle trash is excluded without deleting source bytes', async () => {
    const before = fs.readFileSync(asset.mainFile);
    const meta = JSON.parse(fs.readFileSync(asset.metaPath));
    meta.isDeleted = true;
    fs.writeFileSync(asset.metaPath, JSON.stringify(meta));
    assert.equal((await scanner.scan()).length, 0);
    assert.deepEqual(fs.readFileSync(asset.mainFile), before);
    meta.isDeleted = false;
    fs.writeFileSync(asset.metaPath, JSON.stringify(meta));
  });
  await check('nested Eagle rating changes trigger rescan; stop releases listeners', async () => {
    let observed = [];
    const watcher = new Plugin.LibraryWatcher(plugin, async () => { observed = await scanner.scan(); });
    watcher.start();
    try {
      await new Promise(r => setTimeout(r, 150));
      const meta = JSON.parse(fs.readFileSync(asset.metaPath));
      meta.star = 4;
      fs.writeFileSync(asset.metaPath, JSON.stringify(meta));
      const deadline = Date.now() + 2200;
      while (!observed.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.equal(observed[0]?.star, 4);
    } finally { watcher.stop(); }
    assert.equal(watcher.watchers.length, 0);
    assert.equal(watcher.debounceTimer, null);
  });
  const output = path.resolve(process.env.VISUAL_REPORT || path.join(temp, 'report.json'));
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: output, scenarios: report.scenarios }, null, 2));
  process.exitCode = report.scenarios.every(s => s.passed) ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
