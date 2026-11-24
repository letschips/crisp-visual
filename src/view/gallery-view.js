import { ItemView, Menu, Notice, Platform, TFolder, setIcon } from 'obsidian';
import fs from 'fs';
import path from 'path';
import { ANKS_RAW_INBOX, CRISP_VISUAL_VIEW_TYPE } from '../constants.js';
import { CrispVisualActivationModal, visualEntitled } from '../license.js';
import {
  FILTER_GROUPS, buildInsertSyntax, buildRawCardContent, countLibrary, countPanelFilters,
  createVaultFileIfMissing, emptyFilters, filterItems, formatBytes, hasAnyFilter, rawCardId,
  shuffle, upsertEagleItem
} from '../logic.js';
import { LibraryWatcher, MediaScanner } from '../library/scanner.js';
import { discoverEagleLibraryPath, normalizeEaglePath, toResourceUrl } from '../library/paths.js';
import { ocrSupported } from '../library/ocr.js';
import { imagesFromTransfer, readClipboardImage, transferHasImage } from './clipboard.js';
import { findTargetEditor } from './editor-target.js';
import { InspectorModal } from './inspector.js';
import { MasonryGrid } from './masonry.js';
import {
  CRISP_VISUAL_SVG, ICON_ALL_ASSETS, ICON_GRAYSCALE, ICON_INSERT_NOTE, ICON_OPEN_EAGLE,
  ICON_PASTE, ICON_REFRESH, ICON_SHUFFLE, ICON_SIDEBAR
} from '../icons.js';

const DRAG_TYPE = 'application/x-crisp-visual';
const NARROW_WIDTH = 560;
const DENSITY_ICONS = {
  compact: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="9.5" y="3" width="5" height="5" rx="1"/><rect x="16" y="3" width="5" height="5" rx="1"/><rect x="3" y="9.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><rect x="16" y="9.5" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1"/></svg>',
  standard: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>',
  large: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'
};
const DENSITY_LABELS = { compact: '小图', standard: '中图', large: '大图' };

function isEditable(target) {
  return Boolean(target?.closest?.('input, textarea, [contenteditable="true"]'));
}

/** Eagle library gallery: folders and tags on the left, a masonry of thumbnails on the right. */
export class CrispVisualView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.scanner = new MediaScanner(plugin);
    this.watcher = new LibraryWatcher(plugin, () => this.refresh(true));
    this.items = [];
    this.visibleItems = [];
    this.counts = countLibrary([]);
    this.filters = emptyFilters();
    this.shuffled = null;
    this.expandedFolders = new Set();
    this.sidebarCollapsed = null; // null = automatic: shown in wide panes, hidden in narrow ones (CSS)
    this.filterPanelOpen = false;
    this.grayscale = false;
    this.density = plugin.settings.densityMode || 'standard';
    this.inspector = null;
    this.grid = null;
    this.searchTimer = null;
    this.loading = false;
    this.closed = false;
  }

  getViewType() { return CRISP_VISUAL_VIEW_TYPE; }
  getDisplayText() { return 'Crisp Visual'; }
  getIcon() { return 'crisp-visual-icon'; }

  async onOpen() {
    this.closed = false;
    this.contentEl.addClass('crisp-visual-container');
    this.pasteHandler = e => this.handlePaste(e);
    this.dragoverHandler = e => this.handleDragOver(e);
    this.dragleaveHandler = e => this.handleDragLeave(e);
    this.dropHandler = e => this.handleDrop(e);
    this.containerEl.addEventListener('paste', this.pasteHandler);
    this.containerEl.addEventListener('dragover', this.dragoverHandler);
    this.containerEl.addEventListener('dragleave', this.dragleaveHandler);
    this.containerEl.addEventListener('drop', this.dropHandler);
    await this.refresh();
  }

  async onClose() {
    this.closed = true;
    this.watcher.stop();
    this.closeInspector();
    this.grid?.destroy();
    this.grid = null;
    clearTimeout(this.searchTimer);
    this.containerEl.removeEventListener('paste', this.pasteHandler);
    this.containerEl.removeEventListener('dragover', this.dragoverHandler);
    this.containerEl.removeEventListener('dragleave', this.dragleaveHandler);
    this.containerEl.removeEventListener('drop', this.dropHandler);
  }

  /** Called by the license manager whenever entitlement may have changed. */
  onLicenseChange() {
    this.closeInspector();
    void this.refresh();
  }

  closeInspector() {
    const open = this.inspector;
    this.inspector = null;
    open?.close();
  }

  resourceUrl(filePath, version) {
    return toResourceUrl(Platform.resourcePathPrefix, filePath, version);
  }

  mediaRootReady() {
    const root = normalizeEaglePath(this.plugin.settings.mediaRoot || '');
    return Boolean(root) && fs.existsSync(root);
  }

  anksRawAvailable() {
    return this.app.vault.getAbstractFileByPath(ANKS_RAW_INBOX) instanceof TFolder;
  }

  // ---------- data ----------

  async refresh(silent = false) {
    if (this.closed) return;
    if (!visualEntitled(this.plugin)) {
      // 未激活不读素材库，只显示激活卡片
      this.watcher.stop();
      this.items = [];
      this.visibleItems = [];
      this.renderLocked();
      return;
    }
    if (!silent) {
      this.loading = true;
      if (!this.items.length) this.render();
    }
    const scanned = await this.scanner.scan();
    this.loading = false;
    if (this.closed) return;
    if (!visualEntitled(this.plugin)) return this.refresh();
    this.items = scanned;
    this.counts = countLibrary(scanned);
    this.watcher.start();
    if (this.expandedFolders.size === 0) {
      for (const f of this.scanner.folders) if (f.children?.length) this.expandedFolders.add(f.id);
    }
    if (this.filters.folderId !== 'all' && this.filters.folderId !== 'uncategorized' && !this.scanner.folderMap.has(this.filters.folderId)) {
      this.filters.folderId = 'all';
    }
    if (this.shuffled) {
      // Keep the shuffled order across rescans; new items go first.
      const rank = new Map(this.shuffled.map((it, i) => [it.id, i]));
      this.shuffled = scanned.slice().sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
    }
    this.applyFilters();
    if (silent && this.galleryEl?.isConnected) {
      this.renderSidebar();
      this.renderGallery({ keep: true });
    } else {
      this.render();
    }
  }

  applyFilters() {
    const source = visualEntitled(this.plugin) ? (this.shuffled || this.items) : [];
    this.visibleItems = filterItems(source, this.filters);
  }

  setFilter(patch, { sidebar = false } = {}) {
    Object.assign(this.filters, patch);
    this.applyFilters();
    if (sidebar) this.renderSidebar();
    this.renderFilterState();
    this.renderGallery();
    this.galleryEl?.scrollTo({ top: 0 });
  }

  resetFilters() {
    this.filters = emptyFilters();
    if (this.searchInput) this.searchInput.value = '';
    this.applyFilters();
    this.render();
  }

  // ---------- rendering ----------

  renderLocked() {
    this.closeInspector();
    this.grid?.destroy();
    this.grid = null;
    const container = this.contentEl;
    container.empty();
    container.addClass('crisp-visual-container');
    const card = container.createDiv({ cls: 'crisp-visual-locked' });
    card.innerHTML = CRISP_VISUAL_SVG;
    card.createEl('h3', { text: 'Crisp Visual 未激活' });
    card.createEl('p', { text: '激活后可以浏览、搜索和导入素材。素材文件仍在你的素材库里，不受影响。' });
    const button = card.createEl('button', { text: '输入授权码', cls: 'mod-cta' });
    button.addEventListener('click', () => {
      new CrispVisualActivationModal(this.app, this.plugin, () => this.refresh()).open();
    });
  }

  render() {
    if (!visualEntitled(this.plugin)) {
      this.renderLocked();
      return;
    }
    const container = this.contentEl;
    this.grid?.destroy();
    this.grid = null;
    container.empty();
    container.addClass('crisp-visual-container');
    container.toggleClass('is-sidebar-auto', this.sidebarCollapsed === null);
    container.toggleClass('is-sidebar-shown', this.sidebarCollapsed === false);

    this.renderToolbar(container);
    this.filterPanelEl = container.createDiv({ cls: 'crisp-visual-filter-panel' });
    this.renderFilterPanel();

    const body = container.createDiv({ cls: 'crisp-visual-body' });
    this.sidebarEl = body.createDiv({ cls: 'crisp-visual-sidebar' });
    this.sidebarEl.toggleClass('is-collapsed', this.sidebarCollapsed === true);
    this.renderSidebar();

    this.galleryEl = body.createDiv({
      cls: 'crisp-visual-gallery',
      attr: { tabindex: '-1' }
    });
    this.galleryEl.toggleClass('is-grayscale', this.grayscale);
    this.renderGallery();
  }

  iconButton(parent, { icon, svg, label, cls = '', onClick }) {
    const btn = parent.createEl('button', {
      cls: `crisp-visual-icon-btn clickable-icon ${cls}`.trim(),
      attr: { 'aria-label': label, 'data-tooltip-position': 'bottom' }
    });
    if (svg) btn.innerHTML = svg;
    else setIcon(btn, icon);
    btn.addEventListener('click', onClick);
    return btn;
  }

  renderToolbar(container) {
    const bar = container.createDiv({ cls: 'crisp-visual-toolbar' });

    this.iconButton(bar, {
      svg: ICON_SIDEBAR,
      label: '目录',
      cls: 'crisp-visual-sidebar-toggle',
      onClick: () => {
        this.sidebarCollapsed = this.sidebarVisible();
        this.render();
      }
    });

    const search = bar.createDiv({ cls: 'crisp-visual-search' });
    setIcon(search.createSpan({ cls: 'crisp-visual-search-icon' }), 'search');
    this.scopeChipEl = search.createDiv({ cls: 'crisp-visual-scope-chip' });
    this.searchInput = search.createEl('input', {
      type: 'search',
      attr: { placeholder: '搜索名称、标签、文字', spellcheck: 'false' }
    });
    this.searchInput.value = this.filters.query;
    this.searchInput.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.setFilter({ query: this.searchInput.value }), 120);
    });
    this.searchInput.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.searchInput.value) {
        e.stopPropagation();
        this.searchInput.value = '';
        this.setFilter({ query: '' });
      }
    });

    const tools = bar.createDiv({ cls: 'crisp-visual-tools' });
    this.filterButton = this.iconButton(tools, {
      icon: 'sliders-horizontal',
      label: '筛选',
      cls: 'crisp-visual-filter-toggle',
      onClick: () => {
        this.filterPanelOpen = !this.filterPanelOpen;
        this.renderFilterPanel();
        this.renderFilterState();
      }
    });
    this.filterBadge = this.filterButton.createSpan({ cls: 'crisp-visual-badge-count' });

    this.iconButton(tools, { svg: ICON_PASTE, label: '从剪贴板导入', onClick: () => this.importFromClipboard() });
    const gray = this.iconButton(tools, {
      svg: ICON_GRAYSCALE,
      label: '黑白',
      cls: this.grayscale ? 'is-active' : '',
      onClick: () => {
        this.grayscale = !this.grayscale;
        gray.toggleClass('is-active', this.grayscale);
        this.galleryEl?.toggleClass('is-grayscale', this.grayscale);
      }
    });
    const shuffleBtn = this.iconButton(tools, {
      svg: ICON_SHUFFLE,
      label: '随机顺序',
      cls: this.shuffled ? 'is-active' : '',
      onClick: () => {
        this.shuffled = this.shuffled ? null : shuffle(this.items);
        shuffleBtn.toggleClass('is-active', Boolean(this.shuffled));
        this.setFilter({});
      }
    });
    this.iconButton(tools, { svg: ICON_REFRESH, label: '重新扫描', onClick: () => this.refresh() });

    const density = tools.createDiv({ cls: 'crisp-visual-segmented', attr: { role: 'radiogroup' } });
    for (const mode of ['compact', 'standard', 'large']) {
      const btn = density.createEl('button', {
        cls: `crisp-visual-segment ${this.density === mode ? 'is-active' : ''}`,
        attr: { 'aria-label': DENSITY_LABELS[mode], 'data-tooltip-position': 'bottom', role: 'radio', 'aria-checked': String(this.density === mode) }
      });
      btn.innerHTML = DENSITY_ICONS[mode];
      btn.addEventListener('click', async () => {
        if (this.density === mode) return;
        this.density = mode;
        density.querySelectorAll('button').forEach(b => {
          const on = b === btn;
          b.toggleClass('is-active', on);
          b.setAttr('aria-checked', String(on));
        });
        this.renderGallery();
        this.plugin.settings.densityMode = mode;
        await this.plugin.saveSettings();
      });
    }
    this.renderFilterState();
  }

  /** Badge on the filter button and the folder/tag chip inside the search box. */
  renderFilterState() {
    const n = countPanelFilters(this.filters);
    if (this.filterBadge) {
      this.filterBadge.setText(n ? String(n) : '');
      this.filterBadge.toggleClass('is-hidden', !n);
    }
    this.filterButton?.toggleClass('is-active', this.filterPanelOpen || n > 0);

    const chip = this.scopeChipEl;
    if (!chip) return;
    chip.empty();
    let label = '';
    if (this.filters.tag) label = `#${this.filters.tag}`;
    else if (this.filters.folderId === 'uncategorized') label = '未分类';
    else if (this.filters.folderId !== 'all') label = this.scanner.folderMap.get(this.filters.folderId)?.name || '';
    chip.toggleClass('is-hidden', !label);
    if (!label) return;
    chip.createSpan({ text: label });
    const clear = chip.createEl('button', { attr: { 'aria-label': '移除' } });
    setIcon(clear, 'x');
    clear.addEventListener('click', () => this.setFilter({ folderId: 'all', tag: null }, { sidebar: true }));
  }

  renderFilterPanel() {
    const panel = this.filterPanelEl;
    if (!panel) return;
    panel.empty();
    panel.toggleClass('is-open', this.filterPanelOpen);
    if (!this.filterPanelOpen) return;
    for (const group of FILTER_GROUPS) {
      const row = panel.createDiv({ cls: 'crisp-visual-filter-row' });
      row.createDiv({ cls: 'crisp-visual-filter-label', text: group.label });
      const chips = row.createDiv({ cls: `crisp-visual-chips is-${group.key}` });
      for (const [value, text, swatch] of group.options) {
        const on = this.filters[group.key] === value;
        const chip = chips.createEl('button', {
          cls: `crisp-visual-chip ${on ? 'is-active' : ''}`,
          attr: { 'aria-pressed': String(on), ...(swatch ? { 'aria-label': text, 'data-tooltip-position': 'top' } : {}) }
        });
        if (swatch) {
          chip.addClass('is-swatch');
          chip.style.setProperty('--swatch', swatch);
        } else {
          chip.setText(text);
        }
        chip.addEventListener('click', () => {
          this.setFilter({ [group.key]: on ? 'all' : value });
          this.renderFilterPanel();
        });
      }
    }
    if (countPanelFilters(this.filters)) {
      const clear = panel.createEl('button', { cls: 'crisp-visual-text-btn crisp-visual-filter-clear', text: '清除筛选' });
      clear.addEventListener('click', () => {
        this.setFilter({ color: 'all', ratio: 'all', star: 'all', format: 'all' });
        this.renderFilterPanel();
      });
    }
  }

  navRow(parent, { label, count, active, svg, indent = 0, onClick }) {
    const row = parent.createDiv({ cls: `crisp-visual-nav-row ${active ? 'is-active' : ''}` });
    row.style.setProperty('--indent', String(indent));
    row.setAttr('role', 'button');
    row.setAttr('tabindex', '0');
    const left = row.createDiv({ cls: 'crisp-visual-nav-left' });
    if (svg) left.createSpan({ cls: 'crisp-visual-nav-icon' }).innerHTML = svg;
    left.createSpan({ cls: 'crisp-visual-nav-name', text: label, attr: { title: label } });
    row.createSpan({ cls: 'crisp-visual-nav-count', text: String(count ?? '') });
    row.addEventListener('click', onClick);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
    });
    return { row, left };
  }

  /** Whether the folder list is on screen right now (automatic mode depends on the pane width). */
  sidebarVisible() {
    if (this.sidebarCollapsed !== null) return !this.sidebarCollapsed;
    return Boolean(this.sidebarEl?.isConnected) && getComputedStyle(this.sidebarEl).display !== 'none';
  }

  selectScope(patch) {
    this.setFilter(patch, { sidebar: true });
    // In a narrow pane the folder list covers the gallery; get it out of the way after a pick.
    if (this.contentEl.clientWidth < NARROW_WIDTH && this.sidebarCollapsed === false) {
      this.sidebarCollapsed = null;
      this.render();
    }
  }

  renderSidebar() {
    const sidebar = this.sidebarEl;
    if (!sidebar) return;
    const scrollTop = sidebar.scrollTop;
    sidebar.empty();
    if (this.sidebarCollapsed === true) return;
    const f = this.filters;

    this.navRow(sidebar, {
      label: '全部素材', count: this.items.length, svg: ICON_ALL_ASSETS,
      active: f.folderId === 'all' && !f.tag,
      onClick: () => this.selectScope({ folderId: 'all', tag: null })
    });
    if (this.counts.uncategorized > 0) {
      this.navRow(sidebar, {
        label: '未分类', count: this.counts.uncategorized,
        svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
        active: f.folderId === 'uncategorized',
        onClick: () => this.selectScope({ folderId: 'uncategorized', tag: null })
      });
    }

    if (this.scanner.folders.length) {
      sidebar.createDiv({ cls: 'crisp-visual-nav-heading', text: '目录' });
      const walk = (list, depth) => {
        for (const folder of list) {
          const hasChildren = Array.isArray(folder.children) && folder.children.length > 0;
          const open = this.expandedFolders.has(folder.id);
          const { row, left } = this.navRow(sidebar, {
            label: folder.name, count: this.counts.folders.get(folder.id) || 0, indent: depth,
            active: f.folderId === folder.id && !f.tag,
            onClick: () => this.selectScope({ folderId: folder.id, tag: null })
          });
          const twisty = createSpan({ cls: `crisp-visual-twisty ${hasChildren ? '' : 'is-leaf'} ${open ? 'is-open' : ''}` });
          left.prepend(twisty);
          if (hasChildren) {
            setIcon(twisty, 'chevron-right');
            twisty.addEventListener('click', e => {
              e.stopPropagation();
              if (open) this.expandedFolders.delete(folder.id);
              else this.expandedFolders.add(folder.id);
              this.renderSidebar();
            });
          }
          row.addClass('is-folder');
          if (folder.iconColor) row.dataset.color = folder.iconColor;
          if (hasChildren && open) walk(folder.children, depth + 1);
        }
      };
      walk(this.scanner.folders, 0);
    }

    if (this.counts.tags.size) {
      sidebar.createDiv({ cls: 'crisp-visual-nav-heading', text: '标签' });
      const tags = [...this.counts.tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      for (const [tag, count] of tags) {
        const { left } = this.navRow(sidebar, {
          label: tag, count, active: f.tag === tag,
          onClick: () => this.selectScope({ tag: f.tag === tag ? null : tag, folderId: 'all' })
        });
        left.prepend(createSpan({ cls: 'crisp-visual-tag-hash', text: '#' }));
      }
    }
    sidebar.scrollTop = scrollTop;
  }

  renderGallery({ keep = false } = {}) {
    if (!visualEntitled(this.plugin)) return this.renderLocked();
    const gallery = this.galleryEl;
    if (!gallery) return;
    const scrollTop = gallery.scrollTop;

    if (!this.mediaRootReady()) {
      this.grid?.destroy();
      this.grid = null;
      gallery.empty();
      this.renderSetup(gallery);
      return;
    }
    if (!this.visibleItems.length) {
      this.grid?.destroy();
      this.grid = null;
      gallery.empty();
      const empty = gallery.createDiv({ cls: 'crisp-visual-empty' });
      if (this.loading) {
        empty.createDiv({ cls: 'crisp-visual-empty-title', text: '正在读取素材库…' });
        return;
      }
      if (!this.items.length) {
        empty.createDiv({ cls: 'crisp-visual-empty-title', text: '素材库是空的' });
        empty.createDiv({ cls: 'crisp-visual-empty-hint', text: '在这里粘贴或拖入图片即可导入。' });
        return;
      }
      empty.createDiv({ cls: 'crisp-visual-empty-title', text: '没有符合条件的素材' });
      if (hasAnyFilter(this.filters)) {
        const reset = empty.createEl('button', { cls: 'mod-cta', text: '清除全部筛选' });
        reset.addEventListener('click', () => this.resetFilters());
      }
      return;
    }

    if (!this.grid) {
      gallery.empty();
      this.grid = new MasonryGrid(gallery, (item, column) => this.renderCard(item, column));
    }
    this.grid.setItems(this.visibleItems, { density: this.density, keep });
    if (keep) gallery.scrollTop = scrollTop;
  }

  renderSetup(gallery) {
    const empty = gallery.createDiv({ cls: 'crisp-visual-empty' });
    empty.createDiv({ cls: 'crisp-visual-empty-icon' }).innerHTML = ICON_ALL_ASSETS;
    empty.createDiv({ cls: 'crisp-visual-empty-title', text: '连接 Eagle 素材库' });
    const actions = empty.createDiv({ cls: 'crisp-visual-empty-actions' });
    const detect = actions.createEl('button', { cls: 'mod-cta', text: '自动查找' });
    detect.addEventListener('click', async () => {
      const found = discoverEagleLibraryPath(this.app);
      if (!found) {
        new Notice('没有找到 Eagle 素材库，请在设置里填写路径');
        return;
      }
      this.plugin.settings.mediaRoot = found;
      await this.plugin.saveSettings();
      new Notice(`已连接素材库：${path.basename(path.dirname(found))}`);
      await this.refresh();
    });
    const settings = actions.createEl('button', { text: '打开设置' });
    settings.addEventListener('click', () => {
      this.app.setting?.open?.();
      this.app.setting?.openTabById?.(this.plugin.manifest.id);
    });
  }

  renderCard(item, column) {
    const card = column.createDiv({ cls: 'crisp-visual-card', attr: { draggable: 'true', 'data-id': item.id } });

    const frame = card.createDiv({ cls: 'crisp-visual-thumb' });
    if (item.width && item.height) frame.style.aspectRatio = `${item.width} / ${item.height}`;
    else frame.addClass('is-unknown-ratio');
    const img = frame.createEl('img', { attr: { alt: item.name, loading: 'lazy', decoding: 'async', draggable: 'false' } });
    img.addEventListener('error', () => frame.addClass('is-broken'), { once: true });
    img.src = this.resourceUrl(item.thumbnailPath || item.filePath, item.version);

    const badges = frame.createDiv({ cls: 'crisp-visual-badges' });
    if (item.ext === 'gif' || item.ext === 'svg') badges.createSpan({ cls: 'crisp-visual-badge', text: item.ext.toUpperCase() });
    if (item.star > 0) badges.createSpan({ cls: 'crisp-visual-badge is-star', text: '★'.repeat(item.star) });

    const actions = frame.createDiv({ cls: 'crisp-visual-card-actions' });
    for (const [svg, label, run] of [
      [ICON_INSERT_NOTE, '插入到笔记', () => this.insertToNote(item)],
      [ICON_OPEN_EAGLE, '在 Eagle 中打开', () => window.open(item.eagleUri)]
    ]) {
      const btn = actions.createEl('button', { cls: 'crisp-visual-card-action', attr: { 'aria-label': label, 'data-tooltip-position': 'top' } });
      btn.innerHTML = svg;
      btn.addEventListener('click', e => { e.stopPropagation(); run(); });
    }

    const footer = card.createDiv({ cls: 'crisp-visual-card-footer' });
    footer.createDiv({ cls: 'crisp-visual-card-name', text: item.name, attr: { title: item.name } });
    const dims = item.width && item.height ? `${item.width}×${item.height} · ` : '';
    footer.createDiv({ cls: 'crisp-visual-card-meta', text: `${String(item.ext).toUpperCase()} · ${dims}${formatBytes(item.size)}` });

    card.addEventListener('click', () => this.openInspector(item));
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      this.showContextMenu(e, item);
    });
    card.addEventListener('dragstart', e => {
      const syntax = this.insertSyntax(item);
      if (!syntax) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData('text/plain', syntax);
      e.dataTransfer.setData(DRAG_TYPE, item.id);
      e.dataTransfer.effectAllowed = 'copy';
    });
    return card;
  }

  // ---------- actions ----------

  openInspector(item) {
    if (!visualEntitled(this.plugin)) return;
    this.closeInspector();
    this.inspector = new InspectorModal(this, item);
    this.inspector.open();
  }

  insertSyntax(item) {
    if (!visualEntitled(this.plugin)) {
      new Notice('请先激活 Crisp Visual');
      return '';
    }
    return buildInsertSyntax(item, this.plugin.settings.insertFormat);
  }

  /** Inserts at the cursor of the most recent note; copies to the clipboard when no note is open. */
  insertToNote(item) {
    const syntax = this.insertSyntax(item);
    if (!syntax) return false;
    const target = findTargetEditor(this.app);
    if (target) {
      target.editor.replaceSelection(`\n${syntax}\n`);
      new Notice(target.file ? `已插入到「${target.file.basename}」` : '已插入到笔记');
      return true;
    }
    void navigator.clipboard.writeText(syntax);
    new Notice('没有打开的笔记，已复制 Markdown');
    return true;
  }

  async copyText(text, message) {
    await navigator.clipboard.writeText(text);
    new Notice(message);
  }

  showContextMenu(event, item) {
    const menu = new Menu();
    menu.addItem(i => i.setTitle('插入到笔记').setIcon('image-plus').onClick(() => this.insertToNote(item)));
    menu.addItem(i => i.setTitle('写入当前笔记属性').setIcon('pin').onClick(() => this.bindToActiveNote(item)));
    if (ocrSupported()) {
      menu.addItem(i => i.setTitle(item.ocrText ? '重新识别文字' : '识别文字').setIcon('scan-text').onClick(() => this.recognize(item)));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle('复制 Markdown').setIcon('link').onClick(() => {
      const syntax = this.insertSyntax(item);
      if (syntax) void this.copyText(syntax, '已复制 Markdown');
    }));
    menu.addItem(i => i.setTitle('复制 Eagle 链接').setIcon('external-link').onClick(() => {
      if (this.insertSyntax(item)) void this.copyText(item.eagleUri, '已复制 Eagle 链接');
    }));
    if (this.anksRawAvailable()) {
      menu.addItem(i => i.setTitle('生成 RAW 卡片').setIcon('file-plus').onClick(() => this.createRawCard(item)));
    }
    menu.addSeparator();
    menu.addItem(i => i.setTitle(Platform.isMacOS ? '在访达中显示' : '在文件夹中显示').setIcon('folder').onClick(() => {
      require('electron').shell.showItemInFolder(item.filePath);
    }));
    menu.showAtMouseEvent(event);
  }

  async setRating(item, star) {
    if (!visualEntitled(this.plugin)) return false;
    const ok = await this.scanner.updateItemStar(item, star);
    if (!ok) {
      new Notice('评分没有保存，素材的 metadata.json 无法写入');
      return false;
    }
    this.applyFilters();
    this.renderGallery({ keep: true });
    return true;
  }

  async recognize(item) {
    if (!visualEntitled(this.plugin)) return null;
    const text = await this.scanner.runOCR(item);
    if (text === null) new Notice('文字识别不可用');
    else if (!text) new Notice('没有识别到文字');
    else new Notice(`已识别 ${text.length} 个字`);
    return text;
  }

  async bindToActiveNote(item) {
    if (!visualEntitled(this.plugin)) return;
    const file = findTargetEditor(this.app)?.file || this.app.workspace.getActiveFile();
    if (!file) {
      new Notice('请先打开一篇笔记');
      return;
    }
    try {
      let added = false;
      await this.app.fileManager.processFrontMatter(file, frontmatter => {
        if (!visualEntitled(this.plugin)) throw new Error('授权已失效，未修改笔记');
        added = upsertEagleItem(frontmatter, item);
      });
      new Notice(added ? `已写入「${file.basename}」的 eagle 属性` : `「${file.basename}」已包含这张素材`);
    } catch (e) {
      new Notice(`写入失败：${e.message}`);
    }
  }

  async createRawCard(item) {
    if (!visualEntitled(this.plugin) || !this.anksRawAvailable()) return;
    const cardId = rawCardId(item);
    try {
      const result = await createVaultFileIfMissing(this.app.vault, `${ANKS_RAW_INBOX}/${cardId}.md`, buildRawCardContent(item));
      new Notice(result.created ? `已生成 ${cardId}` : `${cardId} 已存在，未覆盖`);
      await this.app.workspace.getLeaf('tab').openFile(result.file);
    } catch (err) {
      new Notice(`生成卡片失败：${err.message}`);
    }
  }

  // ---------- import ----------

  async ingest(images) {
    if (!visualEntitled(this.plugin)) {
      new CrispVisualActivationModal(this.app, this.plugin, () => this.refresh()).open();
      return;
    }
    if (!this.mediaRootReady()) {
      new Notice('请先连接 Eagle 素材库');
      return;
    }
    const imported = [];
    for (const image of images) {
      try {
        imported.push(await this.scanner.ingestBuffer(image.buffer, image.name, this.filters.folderId, image.ext));
      } catch (err) {
        new Notice(`导入失败：${err.message}`);
      }
    }
    if (!imported.length) return;
    new Notice(imported.length === 1 ? `已导入「${imported[0].name}」` : `已导入 ${imported.length} 张图片`);
    await this.refresh(true);
    if (ocrSupported()) {
      for (const result of imported) {
        const item = this.items.find(i => i.id === result.id);
        if (item) await this.scanner.runOCR(item);
      }
    }
  }

  async importFromClipboard() {
    const image = await readClipboardImage();
    if (!image) {
      new Notice('剪贴板里没有图片');
      return;
    }
    await this.ingest([{ ...image, name: '' }]);
  }

  async handlePaste(e) {
    const transfer = e?.clipboardData;
    // Text pasted into the search box stays text.
    if (isEditable(e?.target) && !transferHasImage(transfer)) return;
    e?.preventDefault?.();
    const images = await imagesFromTransfer(transfer);
    if (images.length) {
      await this.ingest(images.map(i => ({ ...i, name: '' })));
      return;
    }
    await this.importFromClipboard();
  }

  isFileDrag(e) {
    const types = Array.from(e.dataTransfer?.types || []);
    return types.includes('Files') && !types.includes(DRAG_TYPE);
  }

  handleDragOver(e) {
    if (!this.isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    this.galleryEl?.addClass('is-drop-target');
  }

  handleDragLeave(e) {
    if (e.relatedTarget && this.containerEl.contains(e.relatedTarget)) return;
    this.galleryEl?.removeClass('is-drop-target');
  }

  async handleDrop(e) {
    this.galleryEl?.removeClass('is-drop-target');
    if (!this.isFileDrag(e)) return;
    e.preventDefault();
    const images = await imagesFromTransfer(e.dataTransfer);
    if (images.length) await this.ingest(images);
  }
}
