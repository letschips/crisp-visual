# Changelog

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
