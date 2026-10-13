// Run inside Obsidian eval. All writes target a disposable library and a fake editor.
(async () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const real = app.workspace.getLeavesOfType('crisp-visual-view')[0].view;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-license-gates-'));
  let entitled = false, editorWrites = 0;
  const plugin = { settings: { mediaRoot: root, insertFormat: 'standard_markdown' }, licenseManager: { isEntitled: () => entitled } };
  const view = Object.create(Object.getPrototypeOf(real));
  Object.assign(view, { plugin, items: [], searchQuery: '', selectedColor: 'all', selectedFormat: 'all',
    selectedRatio: 'all', selectedStar: 'all', selectedFolderId: 'all', selectedTag: null,
    densityMode: 'standard', galleryContainer: document.createElement('div') });
  Object.defineProperty(view, 'app', { value: { workspace: { activeLeaf: { view: { editor: { replaceSelection() { editorWrites++; } } } } } } });
  const scanner = new real.scanner.constructor(plugin);
  const results = [];
  async function check(name, fn) {
    try { if (!await fn()) throw new Error('assertion failed'); results.push({ name, passed: true }); }
    catch (error) { results.push({ name, passed: false, error: error.message }); }
  }
  const item = { id: 'ONE', name: 'Sample', ext: 'png', filePath: path.join(root, 'sample.png'), tags: [],
    folders: [], foldersNamed: [], mtime: 1, star: 0, width: 1, height: 1, size: 68, eagleUri: 'eagle://item/ONE' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7X8AAAAASUVORK5CYII=', 'base64');
  await check('unactivated import performs zero filesystem writes', async () => {
    try { await scanner.ingestBuffer(png, 'blocked'); } catch {}
    return fs.readdirSync(root).length === 0;
  });
  await check('unactivated insertion performs zero editor writes', () => {
    view.insertToActiveNote(item); return editorWrites === 0;
  });
  await check('unactivated Markdown export returns no usable syntax', () => !view.generateInsertSyntax(item));
  await check('filter cannot expose item outside fixed preview', () => {
    view.items = Array.from({ length: 25 }, (_, i) => ({ ...item, id: String(i), name: `asset-${i}` }));
    view.searchQuery = 'asset-24'; view.applyFilters(); return view.filteredItems.length === 0;
  });
  await check('unactivated synthetic drag cannot export payload', () => {
    view.searchQuery = ''; view.applyFilters(); view.renderMasonry();
    const card = view.galleryContainer.querySelector('.crisp-visual-card');
    const dataTransfer = new DataTransfer();
    const e = new DragEvent('dragstart', { dataTransfer, cancelable: true });
    card.dispatchEvent(e);
    return e.defaultPrevented && dataTransfer.getData('text/plain') === '' && dataTransfer.getData('text/uri-list') === '';
  });
  await check('unactivated OCR and rating writes remain blocked', async () => {
    return await scanner.runOCR(item) === null && await scanner.updateItemStar(item, 5) === false;
  });
  await check('unactivated inspector does not expose previously indexed OCR', () => {
    view.openInspector({ ...item, ocrText: 'PRIVATE_OCR_PROBE' });
    try { return !document.querySelector('.crisp-visual-ocr-box')?.textContent.includes('PRIVATE_OCR_PROBE'); }
    finally { view.inspectorCleanup?.(); }
  });
  await check('inspector image does not offer native drag export', () => {
    view.openInspector(item);
    try { return document.querySelector('.crisp-visual-inspector-img-pane img')?.draggable === false; }
    finally { view.inspectorCleanup?.(); }
  });
  await check('revocation recomputes cached full-library results', () => {
    const manager = new real.plugin.licenseManager.constructor({ workspace: { getLeavesOfType: () => [{ view }] } }, plugin);
    manager.status = { valid: true, payload: {} };
    const originalManager = plugin.licenseManager;
    plugin.licenseManager = manager;
    const originalRender = view.render;
    view.render = () => {};
    try {
      view.searchQuery = ''; view.applyFilters();
      manager.clear();
      return view.filteredItems.length === 20;
    } finally { plugin.licenseManager = originalManager; view.render = originalRender; }
  });
  await check('authorized import, insertion and full-library search remain functional', async () => {
    editorWrites = 0;
    entitled = true;
    const asset = await scanner.ingestBuffer(png, 'allowed');
    view.insertToActiveNote(item);
    view.searchQuery = 'asset-24'; view.applyFilters();
    return fs.existsSync(asset.mainFile) && editorWrites === 1 && view.filteredItems[0]?.id === '24';
  });
  await check('revoked state blocks later insertion and import', async () => {
    entitled = false;
    const before = fs.readdirSync(root).length;
    view.insertToActiveNote(item);
    try { await scanner.ingestBuffer(png, 'revoked'); } catch {}
    return editorWrites === 1 && fs.readdirSync(root).length === before;
  });
  await check('authorization expires while plugin remains loaded', () => {
    const manager = new real.plugin.licenseManager.constructor(app, plugin);
    manager.status = { valid: true, payload: { expiresAt: new Date(Date.now() - 1000).toISOString() } };
    return manager.isEntitled() === false;
  });
  const report = { host: 'Live Obsidian Electron', fixture: root, results, passed: results.every(r => r.passed) };
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  return JSON.stringify(report);
})()
