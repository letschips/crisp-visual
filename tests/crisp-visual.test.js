const assert = require('node:assert/strict');
const { test } = require('node:test');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function loadPlugin(sourceSuffix = '') {
  const originalLoad = Module._load;
  Module._load = function mockObsidian(request, parent, isMain) {
    if (request === 'obsidian') {
      class EmptyBase {}
      return {
        Plugin: EmptyBase,
        ItemView: EmptyBase,
        Notice: EmptyBase,
        PluginSettingTab: EmptyBase,
        Setting: EmptyBase,
        Menu: EmptyBase,
        Modal: EmptyBase,
        addIcon() {},
        requestUrl: async () => ({ json: {} })
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const pluginPath = path.resolve(__dirname, '..', 'main.js');
    if (sourceSuffix) {
      const pluginModule = new Module(pluginPath, module);
      pluginModule.filename = pluginPath;
      pluginModule.paths = Module._nodeModulePaths(path.dirname(pluginPath));
      pluginModule._compile(`${fs.readFileSync(pluginPath, 'utf8')}\n${sourceSuffix}`, pluginPath);
      return pluginModule.exports;
    }
    delete require.cache[pluginPath];
    return require(pluginPath);
  } finally {
    Module._load = originalLoad;
  }
}

const CrispVisualPlugin = loadPlugin();

test('opening the gallery uses the original right sidebar leaf', async () => {
  const calls = [];
  const leaf = {
    async setViewState(state) {
      calls.push(['setViewState', state]);
    }
  };
  const workspace = {
    getLeavesOfType() { return []; },
    getLeaf(location) {
      calls.push(['getLeaf', location]);
      return leaf;
    },
    getRightLeaf() {
      calls.push(['getRightLeaf']);
      return leaf;
    },
    revealLeaf(target) {
      calls.push(['revealLeaf', target]);
    }
  };
  const plugin = Object.create(CrispVisualPlugin.prototype);
  plugin.app = { workspace };

  await plugin.activateView();

  assert.deepEqual(calls[0], ['getRightLeaf']);
  assert.equal(calls.some(([name]) => name === 'getLeaf'), false);
  assert.deepEqual(calls[1], ['setViewState', { type: 'crisp-visual-view', active: true }]);
  assert.deepEqual(calls[2], ['revealLeaf', leaf]);
});

test('imports only target a real selected Eagle folder', () => {
  const folders = new Map([['folder-1', { id: 'folder-1' }]]);
  const { resolveIngestFolders } = CrispVisualPlugin.logic;

  assert.deepEqual(resolveIngestFolders('folder-1', folders), ['folder-1']);
  assert.deepEqual(resolveIngestFolders('all', folders), []);
  assert.deepEqual(resolveIngestFolders('uncategorized', folders), []);
  assert.deepEqual(resolveIngestFolders('missing-folder', folders), []);
});

test('binding a visual appends to existing Eagle metadata and is idempotent', () => {
  const { upsertEagleItem } = CrispVisualPlugin.logic;
  const frontmatter = {
    title: 'Topic',
    eagle: {
      library: 'ANKS',
      items: [{ id: 'asset-a', name: 'A', uri: 'eagle://item/asset-a' }]
    }
  };
  const asset = { id: 'asset-b', name: 'B', eagleUri: 'eagle://item/asset-b' };

  assert.equal(upsertEagleItem(frontmatter, asset), true);
  assert.equal(frontmatter.eagle.library, 'ANKS');
  assert.deepEqual(frontmatter.eagle.items, [
    { id: 'asset-a', name: 'A', uri: 'eagle://item/asset-a' },
    { id: 'asset-b', name: 'B', uri: 'eagle://item/asset-b' }
  ]);
  assert.equal(upsertEagleItem(frontmatter, asset), false);
  assert.equal(frontmatter.eagle.items.length, 2);
});

test('RAW card creation never overwrites an existing knowledge file', async () => {
  const { createVaultFileIfMissing } = CrispVisualPlugin.logic;
  const existing = { path: 'Topics/self-media/raw/inbox/RAW-existing.md' };
  let createCalls = 0;
  const vault = {
    getAbstractFileByPath() { return existing; },
    async create() {
      createCalls += 1;
      throw new Error('must not create');
    }
  };

  const result = await createVaultFileIfMissing(vault, existing.path, 'new content');

  assert.deepEqual(result, { created: false, file: existing });
  assert.equal(createCalls, 0);
});

test('RAW card creation uses the vault API so the new file is immediately addressable', async () => {
  const { createVaultFileIfMissing } = CrispVisualPlugin.logic;
  const created = { path: 'Topics/self-media/raw/inbox/RAW-new.md' };
  const vault = {
    getAbstractFileByPath() { return null; },
    async create(filePath, content) {
      assert.equal(filePath, created.path);
      assert.equal(content, '# card');
      return created;
    }
  };

  const result = await createVaultFileIfMissing(vault, created.path, '# card');

  assert.deepEqual(result, { created: true, file: created });
});

test('unknown dimensions do not masquerade as square images', () => {
  const { matchesRatioFilter } = CrispVisualPlugin.logic;
  const unknown = { width: 0, height: 0 };

  assert.equal(matchesRatioFilter(unknown, '1:1'), false);
  assert.equal(matchesRatioFilter(unknown, 'other'), true);
  assert.equal(matchesRatioFilter(unknown, 'all'), true);
});

test('insert syntax safely handles Markdown characters and reserved file URL characters', () => {
  const { buildInsertSyntax } = CrispVisualPlugin.logic;
  const item = {
    name: 'Hero [final]',
    filePath: '/Users/Test User/Hero (final)#1.png',
    eagleUri: 'eagle://item/asset-1'
  };

  assert.equal(
    buildInsertSyntax(item, 'clickable_embed'),
    '[![Hero \\[final\\]](file:///Users/Test%20User/Hero%20%28final%29%231.png)](eagle://item/asset-1)'
  );
});

test('generated RAW card frontmatter remains valid YAML for punctuation and multiline metadata', () => {
  const { buildRawCardContent } = CrispVisualPlugin.logic;
  const item = {
    id: 'asset-1',
    name: 'Hero: "A"\nNext',
    ext: 'png',
    width: 1200,
    height: 800,
    size: 4096,
    star: 3,
    url: 'https://example.com/a?x=1&y=two',
    eagleUri: 'eagle://item/asset-1',
    filePath: '/tmp/Hero (A).png',
    primaryHex: '#AABBCC',
    primaryColorGroup: 'blue',
    ocrText: 'Text'
  };
  const content = buildRawCardContent(item, new Date('2026-08-24T02:03:00.000Z'));
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)[1];
  const parsed = spawnSync('ruby', ['-ryaml', '-rjson', '-e', 'puts YAML.safe_load(STDIN.read).to_json'], {
    input: frontmatter,
    encoding: 'utf8'
  });

  assert.equal(parsed.status, 0, parsed.stderr);
  const data = JSON.parse(parsed.stdout);
  assert.equal(data.title, item.name);
  assert.equal(data.source_url, item.url);
  assert.equal(data.eagle.uri, item.eagleUri);
});

test('closing a gallery view removes every DOM listener registered when it opened', async () => {
  const { CrispVisualView } = CrispVisualPlugin.classes;
  const registered = new Map();
  const removed = [];
  const view = Object.create(CrispVisualView.prototype);
  view.refresh = async () => {};
  view.watcher = { start() {}, stop() {} };
  view.handlePaste = () => {};
  view.handleDrop = () => {};
  view.containerEl = {
    addEventListener(type, handler) { registered.set(type, handler); },
    removeEventListener(type, handler) { removed.push([type, handler]); }
  };

  await view.onOpen();
  await view.onClose();

  assert.deepEqual([...registered.keys()], ['paste', 'dragover', 'drop']);
  assert.deepEqual(removed, [...registered.entries()]);
});

test('closing a gallery view dismisses an open inspector', async () => {
  const { CrispVisualView } = CrispVisualPlugin.classes;
  const view = Object.create(CrispVisualView.prototype);
  let dismissed = 0;
  view.watcher = { stop() {} };
  view.containerEl = { removeEventListener() {} };
  view.inspectorCleanup = () => { dismissed += 1; };

  await view.onClose();

  assert.equal(dismissed, 1);
});

test('drop-imported GIF keeps its thumbnail extension consistent with its bytes', async () => {
  const TestPlugin = loadPlugin('module.exports.__TestMediaScanner = MediaScanner;');
  const MediaScanner = TestPlugin.__TestMediaScanner;
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-visual-ingest-'));
  const scanner = new MediaScanner({ settings: { mediaRoot } });
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');

  try {
    const result = await scanner.ingestBuffer(gif, 'sample', null, 'gif');
    const files = fs.readdirSync(path.dirname(result.mainFile));

    assert.equal(files.includes('sample_thumbnail.gif'), true);
    assert.equal(files.includes('sample_thumbnail.png'), false);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(result.mainFile), 'sample_thumbnail.gif')), gif);
  } finally {
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  }
});

test('silent library refresh preserves the gallery scroll position', async () => {
  const { CrispVisualView } = CrispVisualPlugin.classes;
  const view = Object.create(CrispVisualView.prototype);
  view.galleryContainer = { scrollTop: 321 };
  view.scanner = { folders: [], async scan() { return []; } };
  view.expandedFolders = new Set();
  view.applyFilters = () => {};
  view.render = () => { view.galleryContainer = { scrollTop: 0 }; };
  const originalAnimationFrame = global.requestAnimationFrame;
  global.requestAnimationFrame = callback => callback();

  try {
    await view.refresh(true);
    assert.equal(view.galleryContainer.scrollTop, 321);
  } finally {
    global.requestAnimationFrame = originalAnimationFrame;
  }
});

test('resetting an empty search clears every active filter in one action', () => {
  const { CrispVisualView } = CrispVisualPlugin.classes;
  const view = Object.create(CrispVisualView.prototype);
  Object.assign(view, {
    searchQuery: 'missing',
    selectedColor: 'red',
    selectedFormat: 'gif',
    selectedRatio: '16:9',
    selectedStar: '5',
    selectedFolderId: 'folder-1',
    selectedTag: 'tag-1'
  });
  let applied = 0;
  let rendered = 0;
  view.applyFilters = () => { applied += 1; };
  view.render = () => { rendered += 1; };

  view.resetFilters();

  assert.deepEqual({
    searchQuery: view.searchQuery,
    selectedColor: view.selectedColor,
    selectedFormat: view.selectedFormat,
    selectedRatio: view.selectedRatio,
    selectedStar: view.selectedStar,
    selectedFolderId: view.selectedFolderId,
    selectedTag: view.selectedTag
  }, {
    searchQuery: '',
    selectedColor: 'all',
    selectedFormat: 'all',
    selectedRatio: 'all',
    selectedStar: 'all',
    selectedFolderId: 'all',
    selectedTag: null
  });
  assert.equal(applied, 1);
  assert.equal(rendered, 1);
});

test('the advertised color filter is rendered and updates the gallery', () => {
  const { CrispVisualView } = CrispVisualPlugin.classes;
  const view = Object.create(CrispVisualView.prototype);
  view.selectedColor = 'blue';
  let changed;
  let applied = 0;
  let rendered = 0;
  const options = [];
  const select = {
    createEl(tag, attrs) {
      assert.equal(tag, 'option');
      const option = { ...attrs, selected: false };
      options.push(option);
      return option;
    },
    addEventListener(type, handler) {
      assert.equal(type, 'change');
      changed = handler;
    }
  };
  const container = {
    createEl(tag, attrs) {
      assert.equal(tag, 'select');
      assert.equal(attrs.title, '按主色调筛选');
      return select;
    }
  };
  view.applyFilters = () => { applied += 1; };
  view.renderGalleryOnly = () => { rendered += 1; };

  view.renderColorFilter(container);

  assert.deepEqual(options.map(option => option.value), [
    'all', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'dark', 'light', 'gray'
  ]);
  assert.equal(options.find(option => option.value === 'blue').selected, true);
  changed({ target: { value: 'red' } });
  assert.equal(view.selectedColor, 'red');
  assert.equal(applied, 1);
  assert.equal(rendered, 1);
});

test('external Eagle names and tags cannot inject inspector or sidebar markup', () => {
  const { escapeHtml } = CrispVisualPlugin.logic;

  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)"> & tag'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; tag'
  );
});
