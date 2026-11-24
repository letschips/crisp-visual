import { Modal, Notice, setIcon } from 'obsidian';
import { visualEntitled } from '../license.js';
import { formatBytes, rgbToHex } from '../logic.js';
import { ocrSupported } from '../library/ocr.js';
import { ICON_GENERATE_ANKS, ICON_INSERT_NOTE, ICON_OPEN_EAGLE } from '../icons.js';

const STAR_SVG = '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>';

/** Large preview with metadata. ← / → move through the current filtered list. */
export class InspectorModal extends Modal {
  constructor(view, item) {
    super(view.app);
    this.view = view;
    this.item = item;
    this.modalEl.addClass('crisp-visual-inspector');
    this.scope.register([], 'ArrowLeft', () => { this.step(-1); return false; });
    this.scope.register([], 'ArrowRight', () => { this.step(1); return false; });
  }

  onOpen() {
    this.renderItem();
  }

  onClose() {
    this.contentEl.empty();
    if (this.view.inspector === this) this.view.inspector = null;
  }

  step(direction) {
    const list = this.view.visibleItems;
    if (!list.length) return;
    let index = list.findIndex(i => i.id === this.item.id);
    if (index === -1) index = 0;
    this.item = list[(index + direction + list.length) % list.length];
    this.renderItem();
  }

  renderItem() {
    if (!visualEntitled(this.view.plugin)) {
      this.close();
      return;
    }
    const item = this.item;
    const { contentEl } = this;
    contentEl.empty();
    this.titleEl.setText(item.name);

    const body = contentEl.createDiv({ cls: 'crisp-visual-inspector-body' });
    const stage = body.createDiv({ cls: 'crisp-visual-inspector-stage' });
    const img = stage.createEl('img', { attr: { alt: item.name, draggable: 'false' } });
    img.src = this.view.resourceUrl(item.filePath, item.version);

    if (this.view.visibleItems.length > 1) {
      for (const [dir, icon, label] of [[-1, 'chevron-left', '上一张'], [1, 'chevron-right', '下一张']]) {
        const btn = stage.createEl('button', {
          cls: `crisp-visual-stage-nav ${dir < 0 ? 'is-prev' : 'is-next'}`,
          attr: { 'aria-label': label }
        });
        setIcon(btn, icon);
        btn.addEventListener('click', () => this.step(dir));
      }
    }

    const side = body.createDiv({ cls: 'crisp-visual-inspector-side' });
    const row = (label, value) => {
      const r = side.createDiv({ cls: 'crisp-visual-meta-row' });
      r.createDiv({ cls: 'crisp-visual-meta-label', text: label });
      return r.createDiv({ cls: 'crisp-visual-meta-val', text: value ?? '' });
    };

    const dims = item.width && item.height ? ` · ${item.width} × ${item.height}` : '';
    row('规格', `${String(item.ext).toUpperCase()}${dims} · ${formatBytes(item.size)}`);
    row('目录', item.foldersNamed.join('、') || '未分类');
    if (item.tags.length) row('标签', item.tags.join('、'));

    const rating = side.createDiv({ cls: 'crisp-visual-meta-row' });
    rating.createDiv({ cls: 'crisp-visual-meta-label', text: '评分' });
    const stars = rating.createDiv({ cls: 'crisp-visual-stars', attr: { role: 'radiogroup' } });
    const paintStars = value => {
      stars.querySelectorAll('button').forEach((b, i) => b.toggleClass('is-on', i < value));
    };
    for (let n = 1; n <= 5; n++) {
      const star = stars.createEl('button', { cls: 'crisp-visual-star', attr: { 'aria-label': `${n} 星` } });
      star.innerHTML = STAR_SVG;
      star.addEventListener('click', async () => {
        const next = item.star === n ? 0 : n;
        if (await this.view.setRating(item, next)) paintStars(next);
      });
    }
    paintStars(item.star || 0);

    const swatches = item.palettes.filter(p => Array.isArray(p.color) && p.color.length === 3);
    if (swatches.length) {
      const colors = side.createDiv({ cls: 'crisp-visual-meta-row' });
      colors.createDiv({ cls: 'crisp-visual-meta-label', text: '颜色' });
      const chips = colors.createDiv({ cls: 'crisp-visual-swatches' });
      for (const p of swatches) {
        const hex = rgbToHex(p.color[0], p.color[1], p.color[2]);
        const chip = chips.createEl('button', { cls: 'crisp-visual-swatch', attr: { 'aria-label': `复制 ${hex}` } });
        chip.style.setProperty('--swatch', hex);
        chip.addEventListener('click', async () => {
          await navigator.clipboard.writeText(hex);
          new Notice(`已复制 ${hex}`);
        });
      }
    }

    if (ocrSupported() || item.ocrText) {
      const ocr = side.createDiv({ cls: 'crisp-visual-meta-row crisp-visual-ocr' });
      const head = ocr.createDiv({ cls: 'crisp-visual-ocr-head' });
      head.createDiv({ cls: 'crisp-visual-meta-label', text: '文字' });
      const box = ocr.createDiv({ cls: 'crisp-visual-ocr-box' });
      const paintText = () => {
        box.setText(item.ocrText || '');
        box.toggleClass('is-empty', !item.ocrText);
      };
      paintText();
      if (ocrSupported()) {
        const run = head.createEl('button', { cls: 'crisp-visual-text-btn', text: item.ocrText ? '重新识别' : '识别' });
        run.addEventListener('click', async () => {
          run.disabled = true;
          run.setText('识别中…');
          const text = await this.view.recognize(item);
          if (this.item !== item) return;
          paintText();
          run.disabled = false;
          run.setText(text ? '重新识别' : '识别');
        });
      }
    }

    const actions = side.createDiv({ cls: 'crisp-visual-inspector-actions' });
    const insert = actions.createEl('button', { cls: 'mod-cta' });
    insert.innerHTML = ICON_INSERT_NOTE;
    insert.createSpan({ text: '插入到笔记' });
    insert.addEventListener('click', () => {
      if (this.view.insertToNote(item)) this.close();
    });

    const eagle = actions.createEl('button');
    eagle.innerHTML = ICON_OPEN_EAGLE;
    eagle.createSpan({ text: '在 Eagle 中打开' });
    eagle.addEventListener('click', () => window.open(item.eagleUri));

    if (this.view.anksRawAvailable()) {
      const card = actions.createEl('button');
      card.innerHTML = ICON_GENERATE_ANKS;
      card.createSpan({ text: '生成 RAW 卡片' });
      card.addEventListener('click', () => {
        this.close();
        void this.view.createRawCard(item);
      });
    }
  }
}
