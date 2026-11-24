const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FakeEl, loadPlugin, notices } = require('./helpers.cjs');

const P = loadPlugin(`
module.exports.__internals = { toResourceUrl, writeJsonAtomic, updateMetadata, ensureOcrBinary, sniffImageExt, getImageDimensionsFromBuffer, columnCountFor, describeLibraryPath };
`);
const L = P.logic;
const I = P.__internals;
const { CrispVisualView, MediaScanner, LibraryWatcher, MasonryGrid } = P.classes;

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64');
const GIF_1x1 = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

function tempLibrary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-visual-'));
  const images = path.join(dir, 'Test.library', 'images');
  fs.mkdirSync(images, { recursive: true });
  return { dir, images, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function writeItem(images, id, meta, files = { [`${meta.name}.${meta.ext}`]: PNG_1x1 }) {
  const info = path.join(images, `${id}.info`);
  fs.mkdirSync(info, { recursive: true });
  fs.writeFileSync(path.join(info, 'metadata.json'), JSON.stringify({ id, ...meta }));
  for (const [name, bytes] of Object.entries(files)) fs.writeFileSync(path.join(info, name), bytes);
  return info;
}

function fakeView(plugin, extra = {}) {
  const view = Object.create(CrispVisualView.prototype);
  Object.assign(view, {
    plugin, app: plugin.app, filters: L.emptyFilters(), items: [], visibleItems: [], shuffled: null, expandedFolders: new Set(),
    scanner: { folders: [], folderMap: new Map() }, containerEl: new FakeEl(), contentEl: new FakeEl()
  }, extra);
  return view;
}

// ---------- opening and lifecycle ----------

test('opening the gallery uses the right sidebar leaf and returns the view', async () => {
  const calls = [];
  const leaf = { view: { id: 'v' }, async setViewState(state) { calls.push(['setViewState', state]); } };
  const workspace = {
    getLeavesOfType() { return []; },
    getLeaf() { calls.push(['getLeaf']); return leaf; },
    getRightLeaf() { calls.push(['getRightLeaf']); return leaf; },
    async revealLeaf(target) { calls.push(['revealLeaf', target]); }
  };
  const plugin = Object.create(P.prototype);
  plugin.app = { workspace };
  const view = await plugin.activateView();
  assert.deepEqual(calls, [['getRightLeaf'], ['setViewState', { type: 'crisp-visual-view', active: true }], ['revealLeaf', leaf]]);
  assert.equal(view, leaf.view);
});

test('closing a gallery view removes every DOM listener it registered and dismisses the inspector', async () => {
  const plugin = P.__entitle({ settings: {}, app: {} }, false);
  const view = fakeView(plugin, { watcher: { stop() {} }, refresh: async () => {} });
  let dismissed = 0;
  await view.onOpen();
  const registered = Object.entries(view.containerEl.listeners).map(([k, v]) => [k, v.length]);
  assert.deepEqual(registered, [['paste', 1], ['dragover', 1], ['dragleave', 1], ['drop', 1]]);
  view.inspector = { close() { dismissed += 1; } };
  await view.onClose();
  assert.ok(Object.values(view.containerEl.listeners).every(list => list.length === 0));
  assert.equal(dismissed, 1);
});

test('refreshOpenViews rescans every open gallery', () => {
  let refreshed = 0;
  const plugin = new P();
  plugin.app = { workspace: { getLeavesOfType: () => [{ view: { refresh() { refreshed += 1; }, watcher: { stop() {} } } }] } };
  plugin.refreshOpenViews();
  assert.equal(refreshed, 1);
});

// ---------- license gate ----------

test('unactivated gallery never scans the library and shows only the activation card', async () => {
  const plugin = P.__entitle({ settings: {}, app: {} }, false);
  let scans = 0, locked = 0, rendered = 0;
  const view = fakeView(plugin, {
    scanner: { folders: [], folderMap: new Map(), async scan() { scans += 1; return [{ id: 'a' }]; } },
    watcher: { start() {}, stop() {} },
    renderLocked() { locked += 1; }
  });
  await view.refresh();
  assert.equal(scans, 0);
  assert.equal(locked, 1);
  assert.deepEqual(view.items, []);
  CrispVisualView.prototype.render.call(view);
  assert.equal(locked, 2, 'render also falls back to the activation card');
  P.__entitle(plugin);
  view.render = () => { rendered += 1; };
  await view.refresh();
  assert.equal(scans, 1);
  assert.equal(rendered, 2, 'a loading state first, then the scanned library');
});

test('status fields and prototype patches cannot unlock', () => {
  const plugin = P.__entitle({ settings: {} }, false);
  const manager = plugin.licenseManager;
  manager.status = { valid: true, payload: {} };
  const Manager = manager.constructor;
  const original = Manager.prototype.isEntitled;
  Manager.prototype.isEntitled = () => true;
  try {
    let locked = 0;
    const view = fakeView(plugin, { renderLocked() { locked += 1; } });
    view.render();
    assert.equal(locked, 1);
  } finally {
    Manager.prototype.isEntitled = original;
  }
});

// ---------- scanning ----------

test('scanner ignores dotfiles, sidecars, thumbnails and Eagle trash, and finds renamed originals', async () => {
  const lib = tempLibrary();
  try {
    writeItem(lib.images, 'A', { name: 'Real', ext: 'png', mtime: 2 }, {
      '.DS_Store': 'x', '000-note.txt': 'sidecar', 'Real.png': PNG_1x1, 'Real_thumbnail.png': PNG_1x1
    });
    writeItem(lib.images, 'B', { name: 'Renamed in Eagle', ext: 'gif', mtime: 1 }, { 'old name.gif': GIF_1x1 });
    writeItem(lib.images, 'C', { name: 'Trash', ext: 'png', isDeleted: true });
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }));
    const items = await scanner.scan();
    assert.deepEqual(items.map(i => i.id), ['A', 'B']);
    assert.equal(path.basename(items[0].filePath), 'Real.png');
    assert.equal(path.basename(items[0].thumbnailPath), 'Real_thumbnail.png');
    assert.equal(path.basename(items[1].filePath), 'old name.gif');
    assert.ok(fs.existsSync(path.join(lib.images, 'C.info', 'Trash.png')), 'trash is skipped, never deleted');
  } finally { lib.cleanup(); }
});

test('rescans re-read only items whose metadata changed and drop removed ones', async () => {
  const lib = tempLibrary();
  try {
    writeItem(lib.images, 'A', { name: 'a', ext: 'png', mtime: 1 });
    writeItem(lib.images, 'B', { name: 'b', ext: 'png', mtime: 2 });
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }));
    const first = await scanner.scan();
    const a1 = first.find(i => i.id === 'A');
    const metaB = path.join(lib.images, 'B.info', 'metadata.json');
    fs.writeFileSync(metaB, JSON.stringify({ id: 'B', name: 'b', ext: 'png', mtime: 2, star: 4 }));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(metaB, future, future);
    const second = await scanner.scan();
    assert.equal(second.find(i => i.id === 'A'), a1, 'unchanged item object is reused');
    assert.equal(second.find(i => i.id === 'B').star, 4);
    fs.rmSync(path.join(lib.images, 'A.info'), { recursive: true });
    assert.deepEqual((await scanner.scan()).map(i => i.id), ['B']);
  } finally { lib.cleanup(); }
});

test('folder membership includes ancestors and folder counts come from one pass', async () => {
  const lib = tempLibrary();
  try {
    fs.writeFileSync(path.join(lib.images, '..', 'metadata.json'), JSON.stringify({
      folders: [{ id: 'P', name: 'Parent', children: [{ id: 'C', name: 'Child', children: [] }] }]
    }));
    writeItem(lib.images, 'A', { name: 'a', ext: 'png', folders: ['C'], tags: ['ui', 'ui'] });
    writeItem(lib.images, 'B', { name: 'b', ext: 'png' });
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }));
    const items = await scanner.scan();
    const counts = L.countLibrary(items);
    assert.equal(counts.folders.get('P'), 1);
    assert.equal(counts.folders.get('C'), 1);
    assert.equal(counts.uncategorized, 1);
    assert.equal(counts.tags.get('ui'), 1);
    assert.deepEqual(L.filterItems(items, { ...L.emptyFilters(), folderId: 'P' }).map(i => i.id), ['A']);
    assert.deepEqual(items.find(i => i.id === 'A').foldersNamed, ['Child']);
  } finally { lib.cleanup(); }
});

test('a missing library yields an empty gallery instead of throwing', async () => {
  const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: '/nonexistent/x.library/images' } }));
  assert.deepEqual(await scanner.scan(), []);
});

// ---------- writing back ----------

test('rating writes metadata atomically and keeps fields Eagle changed meanwhile', async () => {
  const lib = tempLibrary();
  try {
    const info = writeItem(lib.images, 'A', { name: 'a', ext: 'png' });
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }));
    const [item] = await scanner.scan();
    const metaPath = path.join(info, 'metadata.json');
    fs.writeFileSync(metaPath, JSON.stringify({ id: 'A', name: 'a', ext: 'png', tags: ['added-in-eagle'] }));
    assert.equal(await scanner.updateItemStar(item, 3), true);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    assert.equal(meta.star, 3);
    assert.deepEqual(meta.tags, ['added-in-eagle']);
    assert.deepEqual(fs.readdirSync(info).filter(f => f.includes('.crisp-')), [], 'no temp file left behind');
  } finally { lib.cleanup(); }
});

test('imports take their extension from the bytes, not the caller', async () => {
  const lib = tempLibrary();
  try {
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }));
    const gif = await scanner.ingestBuffer(GIF_1x1, 'sample', null, 'png');
    assert.deepEqual(fs.readdirSync(path.dirname(gif.mainFile)).sort(), ['metadata.json', 'sample.gif', 'sample_thumbnail.gif']);
    const meta = JSON.parse(fs.readFileSync(gif.metaPath, 'utf8'));
    assert.equal(meta.ext, 'gif');
    assert.deepEqual([meta.width, meta.height], [1, 1]);
    assert.deepEqual(meta.tags, [], 'named (dropped) files are not tagged as clipboard captures');
    const pasted = await scanner.ingestBuffer(PNG_1x1, '', null, 'png');
    assert.deepEqual(JSON.parse(fs.readFileSync(pasted.metaPath, 'utf8')).tags, ['clipboard']);
  } finally { lib.cleanup(); }
});

test('imports only target a real selected Eagle folder', () => {
  const folders = new Map([['folder-1', { id: 'folder-1' }]]);
  assert.deepEqual(L.resolveIngestFolders('folder-1', folders), ['folder-1']);
  assert.deepEqual(L.resolveIngestFolders('all', folders), []);
  assert.deepEqual(L.resolveIngestFolders('uncategorized', folders), []);
  assert.deepEqual(L.resolveIngestFolders('missing-folder', folders), []);
});

test('unactivated imports are refused at the write boundary', async () => {
  const lib = tempLibrary();
  try {
    const scanner = new MediaScanner(P.__entitle({ settings: { mediaRoot: lib.images } }, false));
    await assert.rejects(() => scanner.ingestBuffer(PNG_1x1, 'x'), /激活/);
    assert.deepEqual(fs.readdirSync(lib.images), []);
  } finally { lib.cleanup(); }
});

test('image byte sniffing recognizes webp size and svg text', () => {
  const webp = Buffer.alloc(32);
  webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12);
  webp.writeUIntLE(799, 24, 3); webp.writeUIntLE(599, 27, 3);
  assert.equal(I.sniffImageExt(webp), 'webp');
  assert.deepEqual(I.getImageDimensionsFromBuffer(webp), { width: 800, height: 600 });
  assert.equal(I.sniffImageExt(Buffer.from('<?xml version="1.0"?><svg></svg>')), 'svg');
  assert.equal(I.sniffImageExt(Buffer.from('hello world')), null);
});

// ---------- watcher ----------

test('the watcher reports Eagle edits and ignores our own temp files', async () => {
  const lib = tempLibrary();
  try {
    const info = writeItem(lib.images, 'A', { name: 'a', ext: 'png' });
    let changes = 0;
    const watcher = new LibraryWatcher(P.__entitle({ settings: { mediaRoot: lib.images } }), () => { changes += 1; });
    watcher.start();
    try {
      // macOS replays the setup writes right after watching starts; let them settle first.
      await new Promise(r => setTimeout(r, 700));
      changes = 0;
      fs.writeFileSync(path.join(info, '.metadata.json.crisp-1-2'), '{}');
      await new Promise(r => setTimeout(r, 700));
      assert.equal(changes, 0);
      fs.writeFileSync(path.join(info, 'metadata.json'), JSON.stringify({ id: 'A', star: 5 }));
      const deadline = Date.now() + 2500;
      while (!changes && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      assert.equal(changes, 1);
    } finally { watcher.stop(); }
    assert.equal(watcher.watchers.length, 0);
    assert.equal(watcher.debounceTimer, null);
  } finally { lib.cleanup(); }
});

// ---------- filters ----------

test('search matches name, tags, folders and OCR text; format treats jpeg as jpg', () => {
  const items = [
    { id: '1', name: 'Hero', ext: 'jpeg', tags: ['brand'], foldersNamed: ['Logos'], ocrText: '你好 world', width: 1600, height: 900, star: 4, primaryColorGroup: 'blue', folders: [] },
    { id: '2', name: 'Icon', ext: 'png', tags: [], foldersNamed: [], ocrText: '', width: 0, height: 0, star: 0, primaryColorGroup: 'red', folders: ['F'] }
  ];
  const f = patch => L.filterItems(items, { ...L.emptyFilters(), ...patch }).map(i => i.id);
  assert.deepEqual(f({ query: '你好' }), ['1']);
  assert.deepEqual(f({ query: 'LOGOS' }), ['1']);
  assert.deepEqual(f({ query: 'brand' }), ['1']);
  assert.deepEqual(f({ format: 'jpg' }), ['1']);
  assert.deepEqual(f({ ratio: '16:9' }), ['1']);
  assert.deepEqual(f({ ratio: 'other' }), ['2'], 'unknown dimensions are "other", never square');
  assert.deepEqual(f({ star: '4' }), ['1']);
  assert.deepEqual(f({ color: 'red' }), ['2']);
  assert.deepEqual(f({ folderId: 'uncategorized' }), ['1']);
  assert.equal(L.countPanelFilters({ ...L.emptyFilters(), color: 'red', star: '3', query: 'x' }), 2);
});

test('every filter option offered in the panel narrows to matching items', () => {
  const keys = L.FILTER_GROUPS.map(g => g.key);
  assert.deepEqual(keys, ['color', 'ratio', 'star', 'format']);
  const colors = L.FILTER_GROUPS[0].options.map(o => o[0]);
  assert.deepEqual(colors, ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'dark', 'light', 'gray']);
  for (const c of colors) {
    const items = [{ id: c, name: c, ext: 'png', primaryColorGroup: c, tags: [], foldersNamed: [] }];
    assert.equal(L.filterItems(items, { ...L.emptyFilters(), color: c }).length, 1, c);
  }
});

test('resetting clears every filter in one action', () => {
  const plugin = P.__entitle({ settings: {} });
  let rendered = 0;
  const view = fakeView(plugin, { render() { rendered += 1; }, searchInput: { value: 'x' } });
  view.filters = { query: 'x', color: 'red', ratio: '16:9', star: '5', format: 'gif', folderId: 'F', tag: 't' };
  view.resetFilters();
  assert.deepEqual(view.filters, L.emptyFilters());
  assert.equal(view.searchInput.value, '');
  assert.equal(rendered, 1);
});

// ---------- gallery layout ----------

test('masonry renders in batches and places the newest items across the first row', () => {
  const scroll = new FakeEl();
  scroll.clientWidth = 3 * 200 + 2 * 12 + 24;
  const order = [];
  const grid = new MasonryGrid(scroll, (item, column) => { order.push([item.id, grid.columns.indexOf(column)]); return column.createDiv(); });
  const items = Array.from({ length: 200 }, (_, i) => ({ id: i, width: 100, height: 100 }));
  grid.setItems(items, { density: 'standard' });
  assert.equal(grid.columns.length, 3);
  assert.deepEqual(order.slice(0, 3).map(([, c]) => c), [0, 1, 2]);
  assert.equal(grid.rendered, 48, 'only the first batch is in the DOM');
  grid.appendBatch();
  assert.equal(grid.rendered, 96);
  grid.setItems(items, { keep: true });
  assert.equal(grid.rendered, 96, 'a silent refresh keeps what was already showing');
  assert.equal(I.columnCountFor(150, 'large'), 1);
  assert.equal(I.columnCountFor(1000, 'compact'), 7);
  grid.destroy();
});

test('thumbnails stream from disk through Obsidian resource URLs', () => {
  assert.equal(I.toResourceUrl('app://abc/', '/Users/a b/图#1?.png', 7), 'app://abc/Users/a%20b/%E5%9B%BE%231%3F.png?7');
  assert.equal(I.toResourceUrl('app://abc/', 'C:\\Lib\\x.png'), 'app://abc/C:/Lib/x.png');
});

// ---------- notes ----------

test('insert goes to the most recent note editor, not the gallery leaf that was clicked', () => {
  const older = { activeTime: 1, view: { getViewType: () => 'markdown', editor: { id: 'old' }, file: { basename: 'Old' } } };
  const newer = { activeTime: 5, view: { getViewType: () => 'markdown', editor: { id: 'new' }, file: { basename: 'New' } } };
  const gallery = { activeTime: 9, view: { getViewType: () => 'crisp-visual-view' } };
  const app = { workspace: { activeEditor: null, iterateAllLeaves: fn => [older, gallery, newer].forEach(fn) } };
  assert.equal(L.findTargetEditor(app).editor.id, 'new');
  app.workspace.activeEditor = { editor: { id: 'active' }, file: null };
  assert.equal(L.findTargetEditor(app).editor.id, 'active');
  assert.equal(L.findTargetEditor({ workspace: { activeEditor: null, iterateAllLeaves() {} } }), null);
});

test('insertToNote writes into the target editor and names the note', () => {
  const inserted = [];
  const app = { workspace: { activeEditor: { editor: { replaceSelection: t => inserted.push(t) }, file: { basename: '选题' } } } };
  const plugin = P.__entitle({ settings: { insertFormat: 'standard_markdown' }, app });
  const view = fakeView(plugin);
  notices.length = 0;
  view.insertToNote({ name: 'a', filePath: '/x/a.png', eagleUri: 'eagle://item/A' });
  assert.deepEqual(inserted, ['\n![a](file:///x/a.png)\n']);
  assert.equal(notices.at(-1), '已插入到「选题」');
});

test('insert syntax escapes Markdown characters and reserved file URL characters', () => {
  const item = { name: 'Hero [final]', filePath: '/Users/Test User/Hero (final)#1.png', eagleUri: 'eagle://item/asset-1' };
  assert.equal(L.buildInsertSyntax(item, 'clickable_embed'),
    '[![Hero \\[final\\]](file:///Users/Test%20User/Hero%20%28final%29%231.png)](eagle://item/asset-1)');
});

test('binding to a note appends to existing Eagle metadata and is idempotent', () => {
  const frontmatter = { eagle: { library: 'ANKS', items: [{ id: 'a', name: 'A', uri: 'eagle://item/a' }] } };
  const asset = { id: 'b', name: 'B', eagleUri: 'eagle://item/b' };
  assert.equal(L.upsertEagleItem(frontmatter, asset), true);
  assert.equal(frontmatter.eagle.library, 'ANKS');
  assert.equal(frontmatter.eagle.items.length, 2);
  assert.equal(L.upsertEagleItem(frontmatter, asset), false);
});

// ---------- ANKS is optional ----------

test('without ANKS the RAW card is not offered and nothing is written', async () => {
  const { Menu, TFolder } = P.__obsidian;
  let created = 0;
  const vault = { getAbstractFileByPath: () => null, create: async () => { created += 1; } };
  const plugin = P.__entitle({ settings: {}, app: { vault } });
  const view = fakeView(plugin);
  view.showContextMenu({}, { id: 'A', name: 'a', filePath: '/x/a.png', eagleUri: 'eagle://item/A', ocrText: '' });
  assert.equal(Menu.last.items.some(i => i.title.includes('RAW')), false);
  await view.createRawCard({ id: 'A' });
  assert.equal(created, 0);

  vault.getAbstractFileByPath = p => (p === 'Topics/self-media/raw/inbox' ? new TFolder() : null);
  view.showContextMenu({}, { id: 'A', name: 'a', filePath: '/x/a.png', eagleUri: 'eagle://item/A', ocrText: '' });
  assert.equal(Menu.last.items.some(i => i.title.includes('RAW')), true);
});

test('RAW card creation never overwrites and uses the vault API', async () => {
  const existing = { path: 'x' };
  const vault = { getAbstractFileByPath: () => existing, async create() { throw new Error('must not create'); } };
  assert.deepEqual(await L.createVaultFileIfMissing(vault, 'x', 'c'), { created: false, file: existing });
  const made = { path: 'y' };
  const vault2 = { getAbstractFileByPath: () => null, async create(p, c) { assert.equal(c, '# card'); return made; } };
  assert.deepEqual(await L.createVaultFileIfMissing(vault2, 'y', '# card'), { created: true, file: made });
});

test('RAW card frontmatter stays valid YAML and uses the local date', () => {
  const item = {
    id: 'asset-1', name: 'Hero: "A"\nNext', ext: 'png', width: 1200, height: 800, size: 4096, star: 3,
    url: 'https://example.com/a?x=1&y=two', eagleUri: 'eagle://item/asset-1', filePath: '/tmp/Hero (A).png',
    primaryHex: '#AABBCC', primaryColorGroup: 'blue', ocrText: 'Text'
  };
  const now = new Date(2026, 7, 24, 23, 30);
  const content = L.buildRawCardContent(item, now);
  assert.equal(L.rawCardId(item, now), 'RAW-20260824-asset-1');
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)[1];
  const parsed = spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'puts YAML.safe_load(STDIN.read).to_json'], { input: frontmatter, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const data = JSON.parse(parsed.stdout);
  assert.equal(data.title, item.name);
  assert.equal(data.source_url, item.url);
  assert.equal(data.created_at, '2026-08-24 23:30');
});

// ---------- paste and drop ----------

test('text pasted into the search box stays text and imports nothing', async () => {
  const plugin = P.__entitle({ settings: {} });
  let ingested = 0;
  const view = fakeView(plugin, { ingest: async () => { ingested += 1; }, importFromClipboard: async () => { ingested += 1; } });
  const input = new FakeEl('input');
  let prevented = false;
  await view.handlePaste({ target: input, clipboardData: { items: [{ kind: 'string', type: 'text/plain' }], files: [] }, preventDefault() { prevented = true; } });
  assert.equal(ingested, 0);
  assert.equal(prevented, false);
});

test('pasting an image file imports it from the event, without touching the system clipboard', async () => {
  const plugin = P.__entitle({ settings: {} });
  const got = [];
  const view = fakeView(plugin, {
    ingest: async images => got.push(...images),
    importFromClipboard: async () => { throw new Error('must use the event data'); }
  });
  const file = { type: 'image/png', name: 'image.png', arrayBuffer: async () => PNG_1x1.buffer.slice(PNG_1x1.byteOffset, PNG_1x1.byteOffset + PNG_1x1.length) };
  await view.handlePaste({ target: new FakeEl('div'), clipboardData: { items: [{ kind: 'file', type: 'image/png' }], files: [file] }, preventDefault() {} });
  assert.equal(got.length, 1);
  assert.equal(got[0].ext, 'png');
  assert.equal(got[0].name, '', 'pasted images get a capture name');
});

test('dragging a gallery card back onto the gallery imports nothing', async () => {
  const plugin = P.__entitle({ settings: {} });
  let ingested = 0;
  const view = fakeView(plugin, { ingest: async () => { ingested += 1; }, galleryEl: new FakeEl() });
  await view.handleDrop({ dataTransfer: { types: ['text/plain', 'application/x-crisp-visual'], files: [] }, preventDefault() {} });
  assert.equal(ingested, 0);
});

// ---------- paths and OCR helper ----------

test('normalizeEaglePath unescapes terminal paths, strips quotes and completes .library to images', () => {
  assert.equal(L.normalizeEaglePath('/Users/r/Library/Mobile\\ Documents/com\\~apple\\~CloudDocs/s.library/images'),
    '/Users/r/Library/Mobile Documents/com~apple~CloudDocs/s.library/images');
  assert.equal(L.normalizeEaglePath('"/Users/r/s.library/images/"'), '/Users/r/s.library/images');
  assert.equal(L.normalizeEaglePath(''), '');
  assert.equal(L.normalizeEaglePath(null), '');
  const lib = tempLibrary();
  try {
    const root = path.dirname(lib.images);
    assert.equal(L.normalizeEaglePath(root), lib.images);
    assert.equal(L.normalizeEaglePath(lib.images), lib.images);
  } finally { lib.cleanup(); }
});

test('the OCR helper lives under the vault\'s own config directory', () => {
  const app = { vault: { configDir: '.obsidian-work', adapter: { basePath: '/v' } } };
  assert.equal(L.getOcrBinaryPath(app), '/v/.obsidian-work/plugins/crisp-visual/vision_ocr');
  assert.equal(L.getOcrBinaryPath(app, '.obsidian-work/plugins/crisp-visual'), '/v/.obsidian-work/plugins/crisp-visual/vision_ocr');
  assert.equal(L.getOcrBinaryPath({ vault: { adapter: { getBasePath: () => '/w' } } }), '/w/.obsidian/plugins/crisp-visual/vision_ocr');
});

test('the embedded OCR helper is written when missing or stale, executable, and matches native/', { skip: process.platform !== 'darwin' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-visual-ocr-'));
  try {
    const target = path.join(dir, 'vision_ocr');
    fs.writeFileSync(target, 'stale');
    assert.equal(await I.ensureOcrBinary(target), target);
    assert.deepEqual(fs.readFileSync(target), fs.readFileSync(path.join(__dirname, '..', 'native', 'vision_ocr')));
    assert.ok(fs.statSync(target).mode & 0o111);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('settings path status distinguishes missing, empty and connected libraries', () => {
  const lib = tempLibrary();
  try {
    assert.equal(I.describeLibraryPath('').state, 'empty');
    assert.equal(I.describeLibraryPath('/nope/x').state, 'error');
    assert.equal(I.describeLibraryPath(lib.images).state, 'warn');
    writeItem(lib.images, 'A', { name: 'a', ext: 'png' });
    assert.deepEqual(I.describeLibraryPath(lib.images), { state: 'ok', text: '已连接，1 项素材' });
  } finally { lib.cleanup(); }
});

test('external names and tags are escaped before reaching markup', () => {
  assert.equal(L.escapeHtml('<img src=x onerror="alert(1)"> & tag'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; tag');
});

test('masonry layout replaces the previous sentinel instead of leaking empty divs', () => {
  const scroll = new FakeEl();
  scroll.clientWidth = 3 * 200 + 2 * 12 + 24;
  const grid = new MasonryGrid(scroll, (_item, column) => column.createDiv());
  const items = Array.from({ length: 10 }, (_, i) => ({ id: i, width: 100, height: 100 }));
  grid.setItems(items, { density: 'standard' });
  grid.setItems(items, { density: 'compact' });
  grid.setItems(items, { keep: true });
  scroll.clientWidth = 2 * 200 + 12 + 24;
  grid.onResize();
  assert.equal(scroll.querySelectorAll('.crisp-visual-sentinel').length, 1);
  grid.destroy();
  assert.equal(scroll.querySelectorAll('.crisp-visual-sentinel').length, 0);
});

test('closing a gallery view while a scan is in flight does not restart the watcher or render', async () => {
  const plugin = P.__entitle({ settings: {}, app: {} });
  let resolveScan;
  let watcherStarted = 0;
  let rendered = 0;
  const view = fakeView(plugin, {
    scanner: {
      folders: [],
      folderMap: new Map(),
      scan: () => new Promise(resolve => { resolveScan = resolve; })
    },
    watcher: { start() { watcherStarted += 1; }, stop() {} },
    render() { rendered += 1; }
  });
  const pending = view.onOpen();
  await Promise.resolve();
  await view.onClose();
  resolveScan([{ id: 'A', name: 'A', tags: [], folders: [], allFolderIds: new Set(), mtime: 1 }]);
  await pending;
  assert.equal(watcherStarted, 0);
  assert.equal(rendered, 1, 'initial loading render happened before close, no post-close render');
});

test('runOCR refreshes item.searchText so recognized text is searchable immediately', { skip: process.platform !== 'darwin' }, async () => {
  const lib = tempLibrary();
  const ocrDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-visual-ocr-run-'));
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect width="360" height="100" fill="white"/><text x="24" y="68" font-family="Helvetica" font-size="48" fill="black">HELLO OCR</text></svg>';
    writeItem(lib.images, 'OCR1', { name: 'poster', ext: 'svg' }, { 'poster.svg': Buffer.from(svg, 'utf8') });
    const plugin = P.__entitle({
      settings: { mediaRoot: lib.images },
      manifest: { dir: '.' },
      app: { vault: { configDir: '.', adapter: { basePath: ocrDir } } }
    });
    const scanner = new MediaScanner(plugin);
    const [item] = await scanner.scan();
    assert.equal(L.filterItems([item], { ...L.emptyFilters(), query: 'hello ocr' }).length, 0);
    const recognized = await scanner.runOCR(item);
    assert.match(recognized, /HELLO OCR/i);
    assert.equal(L.filterItems([item], { ...L.emptyFilters(), query: 'hello ocr' }).length, 1);
  } finally {
    lib.cleanup();
    fs.rmSync(ocrDir, { recursive: true, force: true });
  }
});

test('unreadable data.json is backed up before defaults take over, and saveData is blocked when backup fails', async () => {
  const files = new Map([['.obsidian/plugins/crisp-visual/data.json', '{corrupt']]);
  const adapter = {
    exists: async p => files.has(p),
    read: async p => files.get(p),
    write: async (p, content) => { files.set(p, content); }
  };
  const plugin = Object.create(P.prototype);
  plugin.manifest = { dir: '.obsidian/plugins/crisp-visual' };
  plugin.app = { vault: { adapter } };
  await plugin.protectUnreadableData(undefined);
  const backups = [...files.keys()].filter(k => k.includes('data.json.unreadable-'));
  assert.equal(backups.length, 1);
  assert.equal(files.get(backups[0]), '{corrupt');
  assert.ok(!plugin.dataWriteBlocked);

  const failingPlugin = Object.create(P.prototype);
  failingPlugin.manifest = { dir: '.obsidian/plugins/crisp-visual' };
  failingPlugin.app = { vault: { adapter: { exists: async () => true, read: async () => '{corrupt', write: async () => { throw new Error('disk full'); } } } };
  let superWrites = 0;
  P.__obsidian.Plugin.prototype.saveData = async () => { superWrites += 1; };
  try {
    await failingPlugin.protectUnreadableData(undefined);
    assert.equal(failingPlugin.dataWriteBlocked, true);
    await failingPlugin.saveData({ mediaRoot: '' });
    assert.equal(superWrites, 0);
  } finally {
    delete P.__obsidian.Plugin.prototype.saveData;
  }
});
