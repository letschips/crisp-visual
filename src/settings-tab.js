import { Notice, PluginSettingTab, Setting, setIcon } from 'obsidian';
import fs from 'fs';
import path from 'path';
import { discoverEagleLibraryPath, normalizeEaglePath } from './library/paths.js';

function renderAboutCard(container) {
  const card = container.createEl('section', { cls: 'crisp-visual-about' });
  card.createEl('h3', { cls: 'crisp-visual-about__title', text: '关于 Crisp Visual' });
  card.createEl('p', {
    cls: 'crisp-visual-about__description',
    text: '在 Obsidian 里浏览 Eagle 素材库：按目录、标签、颜色和比例找图，拖进笔记即可引用。'
  });
  const byline = card.createEl('p', { cls: 'crisp-visual-about__author' });
  byline.createSpan({ text: '作者：' });
  byline.createEl('a', {
    cls: 'crisp-visual-about__author-link',
    text: '小红书 letschips',
    href: 'https://xhslink.cn/m/3MwtKu4822b',
    attr: { target: '_blank', rel: 'noopener noreferrer' }
  });
}

/** Describes what is at `rawPath`: { state: 'empty' | 'error' | 'warn' | 'ok', text }. */
export function describeLibraryPath(rawPath) {
  const p = normalizeEaglePath(rawPath || '');
  if (!p) return { state: 'empty', text: '未设置。可以粘贴 .library 或其中 images 文件夹的路径。' };
  try {
    if (!fs.existsSync(p)) return { state: 'error', text: `路径不存在：${p}` };
    if (!fs.statSync(p).isDirectory()) return { state: 'error', text: `不是文件夹：${p}` };
    const count = fs.readdirSync(p, { withFileTypes: true }).filter(e => e.isDirectory() && e.name.endsWith('.info')).length;
    return count > 0
      ? { state: 'ok', text: `已连接，${count} 项素材` }
      : { state: 'warn', text: '文件夹里没有 Eagle 素材（.info），请确认指向 .library/images' };
  } catch (e) {
    return { state: 'error', text: `读取失败：${e.message}` };
  }
}

export class CrispVisualSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.licenseDraft = plugin.settings?.licenseCode || '';
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const brandHeader = containerEl.createDiv({ cls: 'crisp-brand-header' });
    setIcon(brandHeader.createDiv({ cls: 'crisp-brand-logo' }), 'crisp-visual-icon');
    brandHeader.createEl('h2', { text: 'Crisp Visual' });
    containerEl.createEl('p', { text: '找图、看图，就在笔记旁', cls: 'crisp-brand-slogan' });

    renderAboutCard(containerEl);

    new Setting(containerEl).setName('软件授权').setHeading();

    const statusSetting = new Setting(containerEl).setName('当前激活状态');
    const licenseStatus = this.plugin.licenseManager ? this.plugin.licenseManager.getStatus() : { valid: false };
    if (licenseStatus.valid && licenseStatus.payload) {
      const owner = licenseStatus.payload.userName || "Crisp 用户";
      const product = licenseStatus.payload.product || "Crisp Suite";
      const expiry = licenseStatus.payload.expiresAt
        ? `，到期时间: ${String(licenseStatus.payload.expiresAt).split("T")[0]}`
        : "";
      const verification = licenseStatus.source === "offline" ? "离线验证" : "在线验证";
      statusSetting.setDesc(`✅ 已激活（${verification} · ${product} · 授权给: ${owner}${expiry}）`);
      statusSetting.addButton(btn => btn
        .setButtonText('清除激活')
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.licenseCode = '';
          this.plugin.licenseManager.clear();
          this.licenseDraft = '';
          await this.plugin.saveSettings();
          new Notice('已清除当前插件激活信息');
          this.display();
        }));
    } else if (this.plugin.settings.licenseCode) {
      statusSetting.setDesc(`❌ 未激活（${licenseStatus.reason || "授权码无效"}）`);
    } else {
      statusSetting.setDesc('❌ 未激活（支持 Crisp Suite 一码激活所有插件）');
    }

    if (!licenseStatus.valid) {
      new Setting(containerEl)
        .setName('输入授权码')
        .setDesc('一码激活所有 Crisp 插件（支持 Crisp Suite / Crisp Visual 授权码）')
        .addText(text => {
          text.inputEl.type = 'password';
          text
            .setPlaceholder('粘贴 Crisp 授权码 (xxxx.xxxx)...')
            .setValue(this.licenseDraft || this.plugin.settings.licenseCode)
            .onChange(val => { this.licenseDraft = val.trim(); });
        })
        .addButton(btn => btn
          .setButtonText('激活 / 验证')
          .setCta()
          .onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText('验证中...');
            const res = await this.plugin.activateLicense(this.licenseDraft);
            new Notice(res.valid ? 'Crisp Visual 激活成功' : `激活失败：${res.reason || "未知错误"}`);
            this.display();
          }));
    }

    new Setting(containerEl).setName('素材库').setHeading();

    const mediaSetting = new Setting(containerEl).setName('Eagle 素材库路径');
    const statusEl = containerEl.createDiv({ cls: 'crisp-visual-path-status' });
    const updateStatus = rawVal => {
      const { state, text } = describeLibraryPath(rawVal);
      statusEl.className = `crisp-visual-path-status is-${state}`;
      statusEl.setText(text);
    };
    updateStatus(this.plugin.settings.mediaRoot);

    mediaSetting.addText(text => {
      text
        .setPlaceholder('/path/to/Library.library')
        .setValue(this.plugin.settings.mediaRoot)
        .onChange(async val => {
          this.plugin.settings.mediaRoot = normalizeEaglePath(val);
          await this.plugin.saveSettings();
          updateStatus(this.plugin.settings.mediaRoot);
          this.plugin.refreshOpenViews();
        });
      text.inputEl.addEventListener('input', e => updateStatus(e.target.value));
      text.inputEl.addEventListener('blur', () => {
        text.setValue(this.plugin.settings.mediaRoot);
        updateStatus(this.plugin.settings.mediaRoot);
      });
    });

    mediaSetting.addButton(btn => btn
      .setButtonText('自动查找')
      .onClick(async () => {
        const found = discoverEagleLibraryPath(this.app);
        if (!found) {
          new Notice('没有在库目录附近或「图片」文件夹里找到 Eagle 素材库，请手动填写');
          return;
        }
        this.plugin.settings.mediaRoot = found;
        await this.plugin.saveSettings();
        this.plugin.refreshOpenViews();
        new Notice(`已连接素材库：${path.basename(path.dirname(found))}`);
        this.display();
      }));

    new Setting(containerEl)
      .setName('插入格式')
      .addDropdown(drop => drop
        .addOption('clickable_embed', '图片，点击在 Eagle 中打开')
        .addOption('standard_markdown', '图片')
        .addOption('raw_link', '链接到 Eagle')
        .setValue(this.plugin.settings.insertFormat)
        .onChange(async val => {
          this.plugin.settings.insertFormat = val;
          await this.plugin.saveSettings();
        }));
  }
}
