// Pure helpers: no Obsidian, no file system. Covered directly by tests/logic.test.js.
import { pathToFileURL } from 'url';

export function classifyRGB(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2 / 255;
  const d = (max - min) / 255;

  if (l < 0.15) return 'dark';
  if (l > 0.88 && d < 0.12) return 'light';
  if (d < 0.1) return 'gray';

  let h = 0;
  if (max === r) h = ((g - b) / 255) / d % 6;
  else if (max === g) h = ((b - r) / 255) / d + 2;
  else h = ((r - g) / 255) / d + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  if (h >= 345 || h < 15) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'cyan';
  if (h < 265) return 'blue';
  return 'purple';
}

export function rgbToHex(r, g, b) {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
}

export function generateEagleId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = 'MT' + Date.now().toString(36).toUpperCase().slice(-4);
  while (result.length < 13) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function resolveIngestFolders(folderId, folderMap) {
  if (!folderId || folderId === 'all' || folderId === 'uncategorized') return [];
  return folderMap && folderMap.has(folderId) ? [folderId] : [];
}

export function upsertEagleItem(frontmatter, item) {
  if (!frontmatter.eagle || typeof frontmatter.eagle !== 'object' || Array.isArray(frontmatter.eagle)) {
    frontmatter.eagle = {};
  }
  if (!Array.isArray(frontmatter.eagle.items)) {
    frontmatter.eagle.items = [];
  }
  if (frontmatter.eagle.items.some(existing => existing && existing.id === item.id)) {
    return false;
  }
  frontmatter.eagle.items.push({ id: item.id, name: item.name, uri: item.eagleUri });
  return true;
}

export async function createVaultFileIfMissing(vault, filePath, content) {
  const existing = vault.getAbstractFileByPath(filePath);
  if (existing) return { created: false, file: existing };
  const file = await vault.create(filePath, content);
  return { created: true, file };
}

const RATIO_RANGES = {
  '1:1': r => r >= 0.92 && r <= 1.08,
  '3:4': r => r >= 0.68 && r <= 0.82,
  '4:3': r => r >= 1.25 && r <= 1.45,
  '9:16': r => r >= 0.50 && r <= 0.65,
  '16:9': r => r >= 1.65 && r <= 1.95,
  'banner': r => r > 1.95,
  'long': r => r < 0.50
};

export function matchesRatioFilter(item, selectedRatio) {
  if (selectedRatio === 'all') return true;
  if (!item.width || !item.height) return selectedRatio === 'other';
  const ratio = item.width / item.height;
  if (selectedRatio === 'other') return !Object.values(RATIO_RANGES).some(test => test(ratio));
  const test = RATIO_RANGES[selectedRatio];
  return test ? test(ratio) : true;
}

// Filter choices shown in the filter panel. Values are the persisted filter keys.
export const FILTER_GROUPS = [
  {
    key: 'color', label: '颜色', options: [
      ['red', '红色', '#e5484d'], ['orange', '橙色', '#f76b15'], ['yellow', '黄色', '#ffc53d'],
      ['green', '绿色', '#30a46c'], ['cyan', '青色', '#05a2c2'], ['blue', '蓝色', '#0090ff'],
      ['purple', '紫色', '#8e4ec6'], ['dark', '深色', '#1c1c1e'], ['light', '浅色', '#f2f2f7'],
      ['gray', '灰色', '#8e8e93']
    ]
  },
  {
    key: 'ratio', label: '比例', options: [
      ['1:1', '1:1'], ['3:4', '3:4'], ['4:3', '4:3'], ['9:16', '9:16'], ['16:9', '16:9'],
      ['banner', '横幅'], ['long', '长图'], ['other', '其他']
    ]
  },
  { key: 'star', label: '评分', options: [['3', '3 星以上'], ['4', '4 星以上'], ['5', '5 星']] },
  { key: 'format', label: '格式', options: [['png', 'PNG'], ['jpg', 'JPG'], ['gif', 'GIF'], ['svg', 'SVG'], ['webp', 'WEBP']] }
];

export function emptyFilters() {
  return { query: '', color: 'all', ratio: 'all', star: 'all', format: 'all', folderId: 'all', tag: null };
}

/** Number of narrowing choices made in the filter panel (search, folder and tag excluded). */
export function countPanelFilters(filters) {
  return ['color', 'ratio', 'star', 'format'].filter(key => filters[key] !== 'all').length;
}

export function hasAnyFilter(filters) {
  return Boolean(filters.query.trim() || filters.tag || filters.folderId !== 'all' || countPanelFilters(filters));
}

const normalizeExt = ext => {
  const e = String(ext || '').toLowerCase();
  return e === 'jpeg' ? 'jpg' : e;
};

/** Lower-cased text the search box matches: name, tags, folders, annotation, OCR text. */
export function buildSearchText(item) {
  return [item.name, ...(item.tags || []), ...(item.foldersNamed || []), item.annotation, item.ocrText]
    .filter(Boolean).join('\n').toLowerCase();
}

export function filterItems(items, filters) {
  const q = (filters.query || '').toLowerCase().trim();
  const minStar = filters.star === 'all' ? 0 : parseInt(filters.star, 10) || 0;
  const format = filters.format === 'all' ? '' : normalizeExt(filters.format);
  return items.filter(item => {
    if (q) {
      const text = item.searchText ?? buildSearchText(item);
      if (!text.includes(q) && normalizeExt(item.ext) !== normalizeExt(q)) return false;
    }
    if (filters.color !== 'all' && item.primaryColorGroup !== filters.color) return false;
    if (format && normalizeExt(item.ext) !== format) return false;
    if (!matchesRatioFilter(item, filters.ratio)) return false;
    if (minStar && (item.star || 0) < minStar) return false;
    if (filters.folderId === 'uncategorized') {
      if (item.folders && item.folders.length > 0) return false;
    } else if (filters.folderId !== 'all') {
      if (!item.allFolderIds || !item.allFolderIds.has(filters.folderId)) return false;
    }
    if (filters.tag && !(item.tags || []).includes(filters.tag)) return false;
    return true;
  });
}

/** One pass over the library: per-folder (with ancestors), uncategorized and tag counts. */
export function countLibrary(items) {
  const folders = new Map();
  const tags = new Map();
  let uncategorized = 0;
  for (const item of items) {
    if (!item.folders || item.folders.length === 0) uncategorized += 1;
    for (const id of item.allFolderIds || []) folders.set(id, (folders.get(id) || 0) + 1);
    for (const tag of new Set(item.tags || [])) {
      if (tag) tags.set(tag, (tags.get(tag) || 0) + 1);
    }
  }
  return { folders, tags, uncategorized };
}

export function shuffle(list, random = Math.random) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function formatBytes(size) {
  const n = Number(size) || 0;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function buildFileUrl(filePath) {
  return pathToFileURL(filePath).href
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

export function escapeMarkdownLabel(value) {
  return String(value || '').replace(/([\\[\]])/g, '\\$1').replace(/[\r\n]+/g, ' ');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildInsertSyntax(item, mode) {
  const fileUrl = buildFileUrl(item.filePath);
  const label = escapeMarkdownLabel(item.name);
  if (mode === 'standard_markdown') return `![${label}](${fileUrl})`;
  if (mode === 'clickable_embed') return `[![${label}](${fileUrl})](${item.eagleUri})`;
  return `[查看素材 → ${label}](${item.eagleUri})`;
}

function localStamp(now) {
  const pad = n => String(n).padStart(2, '0');
  return {
    day: `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`,
    minute: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
  };
}

export function rawCardId(item, now = new Date()) {
  return `RAW-${localStamp(now).day}-${item.id}`;
}

export function buildRawCardContent(item, now = new Date()) {
  const cardId = rawCardId(item, now);
  const displayTitle = String(item.name || '').replace(/[\r\n]+/g, ' ').trim();
  const yaml = value => JSON.stringify(String(value ?? ''));
  const fileUrl = buildFileUrl(item.filePath);
  const dims = item.width && item.height ? `${item.width} × ${item.height}, ` : '';

  return `---
id: ${yaml(cardId)}
type: "raw"
topic: "self-media"
owner: "topic:self-media"
title: ${yaml(item.name)}
status: "inbox"
source_type: "visual"
source_url: ${yaml(item.url)}
created_at: ${yaml(localStamp(now).minute)}
routing_confidence: 1
routing_reason: "Crisp Visual Ingest"
eagle:
  item_id: ${yaml(item.id)}
  ext: ${yaml(item.ext)}
  dimensions: ${yaml(`${item.width}x${item.height}`)}
  size_bytes: ${Number(item.size) || 0}
  star: ${Number(item.star) || 0}
  uri: ${yaml(item.eagleUri)}
---

# 视觉素材：${displayTitle}

[![${escapeMarkdownLabel(item.name)}](${fileUrl})](${item.eagleUri})

## 视觉元数据
- **素材 ID**：\`${item.id}\`
- **规格**：\`${String(item.ext || '').toUpperCase()} (${dims}${formatBytes(item.size)})\`
- **主色**：\`${item.primaryHex} (${item.primaryColorGroup})\`
- **评分**：\`${'★'.repeat(item.star || 0) || '未评分'}\`

## 识别文字
\`\`\`text
${item.ocrText || item.annotation || '（暂无）'}
\`\`\`

## 观察与思考
- **视觉特征**：
- **为什么收藏**：
- **可以用在哪里**：
`;
}
