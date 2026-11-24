import { Plugin, Notice, addIcon } from 'obsidian';
import { CRISP_VISUAL_VIEW_TYPE, DEFAULT_SETTINGS } from './constants.js';
import { preserveUnreadableData } from './data-safety.js';
import { CRISP_VISUAL_SVG } from './icons.js';
import { VISUAL_LICENSE_OWNER, VISUAL_LICENSE_TIMERS, visualLicenseManagerFor } from './license.js';
import { discoverEagleLibraryPath, getOcrBinaryPath, normalizeEaglePath } from './library/paths.js';
import { LibraryWatcher, MediaScanner } from './library/scanner.js';
import * as logic from './logic.js';
import { CrispVisualSettingTab } from './settings-tab.js';
import { CrispVisualView } from './view/gallery-view.js';
import { findTargetEditor } from './view/editor-target.js';
import { MasonryGrid } from './view/masonry.js';

export default class CrispVisualPlugin extends Plugin {

  // Never overwrite a data.json that could not be read and could not be backed up either.
  async saveData(data) {
    if (this.dataWriteBlocked) return;
    await super.saveData(data);
  }

  // loadData() yields undefined when data.json exists but cannot be read; keep a copy before defaults take over.
  async protectUnreadableData(raw) {
    if (raw !== undefined) return;
    const result = await preserveUnreadableData(this.app?.vault?.adapter, `${this.manifest?.dir}/data.json`);
    if (result.state === "preserved") {
      new Notice(`Crisp Visual 的设置文件无法读取，已备份为 ${result.backupPath.split("/").pop()} 并恢复默认设置。`, 12000);
    } else if (result.state === "failed") {
      this.dataWriteBlocked = true;
      console.error("Crisp Visual could not back up unreadable data.json", result.error);
      new Notice("Crisp Visual 的设置文件无法读取，也无法备份。为保护原文件，本次运行不会保存设置。", 0);
    }
  }

  async onload() {
    console.log(`[Crisp Visual] Loading plugin v${this.manifest.version}...`);
    await this.loadSettings();

    // Initialize License Manager & Auto-inherit from Crisp Suite
    await visualLicenseManagerFor(this).initialize();

    addIcon('crisp-visual-icon', CRISP_VISUAL_SVG);
    this.registerView(CRISP_VISUAL_VIEW_TYPE, leaf => new CrispVisualView(leaf, this));
    this.addRibbonIcon('crisp-visual-icon', 'Crisp Visual', () => this.activateView());

    this.addCommand({
      id: 'open-crisp-visual-gallery',
      name: '打开视觉资产画廊',
      callback: () => this.activateView()
    });

    this.addCommand({
      id: 'crisp-visual-paste-clipboard',
      name: '从系统剪贴板快速导入图片素材',
      callback: async () => {
        const view = await this.activateView();
        await view?.importFromClipboard?.();
      }
    });

    this.addSettingTab(new CrispVisualSettingTab(this.app, this));
  }

  onunload() {
    clearTimeout(VISUAL_LICENSE_TIMERS.get(VISUAL_LICENSE_OWNER.get(this)));
  }

  async activateLicense(code) {
    return await this.licenseManager.verify(code);
  }

  async loadSettings() {
    const stored = await this.loadData();
    await this.protectUnreadableData(stored);
    this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
    if (this.settings.mediaRoot) {
      this.settings.mediaRoot = normalizeEaglePath(this.settings.mediaRoot);
    } else {
      const autoDiscovered = discoverEagleLibraryPath(this.app);
      if (autoDiscovered) this.settings.mediaRoot = autoDiscovered;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshOpenViews() {
    for (const leaf of this.app?.workspace?.getLeavesOfType?.(CRISP_VISUAL_VIEW_TYPE) || []) {
      leaf.view?.watcher?.stop?.();
      void leaf.view?.refresh?.();
    }
  }

  /** Opens (or reveals) the gallery in the right sidebar and returns its view. */
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(CRISP_VISUAL_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf ? workspace.getRightLeaf(false) : null;
      if (!leaf) leaf = workspace.getLeaf(true);
      await leaf.setViewState({ type: CRISP_VISUAL_VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    return leaf.view;
  }
}

CrispVisualPlugin.logic = Object.freeze({ ...logic, normalizeEaglePath, getOcrBinaryPath, findTargetEditor });
CrispVisualPlugin.classes = Object.freeze({ CrispVisualView, MediaScanner, LibraryWatcher, MasonryGrid });
