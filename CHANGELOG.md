# Changelog

## [0.2.10] - 2026-10-13

### Fixed
- 未激活时阻止笔记插入、Markdown/协议链接复制及素材拖拽；导入底层在写入前再次校验授权。
- 未激活预览范围在筛选前限制为固定前 20 张，不能通过搜索或切换目录浏览全库；已索引 OCR 文案需要激活后查看和检索。
- 授权运行中到期立即阻止核心操作；撤销后关闭检查器并重新计算预览范围；OCR 完成及笔记绑定写入前复查授权。
- 不再显示 Eagle 回收站中的素材，保留原文件不做删除。
- 按 Eagle 元数据和扩展名选择原文件，避免把旁置文件或目录作为图片插入笔记；素材改名后仍可找到原文件。
- 监听素材子目录内的变更，外部修改评分、标签及 OCR 后自动刷新画廊。
- 启动日志显示实际安装版本。

## [0.2.9] - 2026-10-04

### Fixed
- 授权自动继承按当前库的配置目录查找其他 Crisp 插件；使用自定义配置目录时也能找到已有授权，并且不会误读默认目录中的旧授权。
- 使用自定义配置目录时，图片文字识别（OCR）能找到插件自带的识别程序。此前会去默认的 `.obsidian` 目录查找，找不到时 OCR 不工作。
- 库里同时有多张 Crisp 授权码时，Visual 现在会选用第一张对 Visual 有效的，而不是第一张找到的。此前如果前面是别的单款授权，会显示未激活，即使后面有可用的全家桶授权。

## [0.2.8] - 2026-09-30

### Fixed
- `data.json` 损坏无法读取时（例如同步冲突或写入中断），先备份为 `data.json.unreadable-<时间>` 再恢复默认设置，避免授权码和设置被静默覆盖；无法备份时本次运行不保存设置。

## [0.2.7] - 2026-09-18

### Improved
- 优化体验。

## [0.2.6] - 2026-09-12

### Security & Stability
- 强化启动时授权凭据加密验证与异步撤销处理。
- 补充隔离 HTTP 授权测试用例。

## [0.2.5] - 2026-09-07

### Improved
- 优化体验。

## [0.2.4] - 2026-09-07

### Improved
- 优化体验。

## [0.2.3] - 2026-09-06

### Fixed
- Bug fixes.

## [0.2.2] - 2026-08-24

### Fixed
- Bug fixes.

## [0.2.1] - 2026-08-24

### Fixed
- Remove Obsidian's redundant default view header above the gallery toolbar.
- Prevent stale left-sidebar paint in macOS translucent-window mode while Crisp Visual is active.
- Dismiss the inspector cleanly when its right-sidebar view closes.
- Keep imported thumbnail extensions consistent with their actual image bytes.
- Defer offscreen gallery image decoding and preserve usable cards in very narrow sidebars.
- Respect reduced-motion preferences across gallery and inspector interactions.
- Preserve existing `eagle.items` bindings and avoid duplicate visual bindings.
- Never overwrite an existing ANKS RAW card; new cards now use the Obsidian Vault API.
- Keep imported assets unclassified unless a real Eagle folder is selected.
- Treat missing image dimensions as unknown instead of square.
- Escape Markdown paths and RAW-card YAML metadata safely.
- Remove all view listeners on close and preserve scroll during background library refreshes.

### Improved
- Added the missing dominant-color filter and a one-click reset when filters return no results.
- Added regression coverage for gallery opening, imports, bindings, card creation, ratios, links, lifecycle, refresh, and filters.

## [0.1.0] - 2026-08-21

### Added
- **Apple-Aesthetic Masonry Gallery**: Smooth dynamic multi-column masonry view with responsive cards, resolution badges, GIF/SVG tags, and star ratings.
- **Eagle Library Mounting**: Direct integration with Eagle desktop library ( or ), recursive folder tree navigation, and live count aggregation.
- **Dynamic Tag Filtering**: Automatic aggregation of tags across visual assets in the sidebar.
- **Multi-Dimensional Filter Bar**: Aspect ratio (landscape, portrait, square, banner), color palette group (red, orange, yellow, green, blue, purple, dark), format, and star rating filters.
- **Grayscale Inspiration Mode**: Instant monochrome toggle to analyze visual layout composition and contrast rhythm.
- **Local Offline Vision OCR Engine**: macOS native  text extraction with instant ad-hoc search indexing.
- **Instant Clipboard & Drop Capture**: Quick ingest via  or drag-and-drop with binary file header dimension detection.
- **Inspector Modal & Keyboard Navigation**: Full-screen preview with keyboard arrow ( / ) roaming, ESC close, one-click color HEX copy, and star rating adjustments.
- **ANKS RAW Knowledge Card Generator**: One-click generation of bidirectional  cards.
- **Unified Crisp Licensing**: Seamless license discovery across the Crisp plugin suite with Ed25519 cryptographic verification.
