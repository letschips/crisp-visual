export const CRISP_VISUAL_VIEW_TYPE = 'crisp-visual-view';

export const DEFAULT_SETTINGS = {
  mediaRoot: '',
  densityMode: 'standard', // 'compact' | 'standard' | 'large'
  columnCount: 3,
  insertFormat: 'clickable_embed', // 'clickable_embed' | 'standard_markdown' | 'raw_link'
  autoScanOnOpen: true,
  enableHoverPlay: true,
  licenseCode: '',
  licenseLastOnlineAt: 0
};

// ANKS is optional: RAW cards are offered only when this inbox exists in the vault.
export const ANKS_RAW_INBOX = 'Topics/self-media/raw/inbox';

export const IMPORTABLE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'];
