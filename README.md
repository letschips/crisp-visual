# Crisp Visual

> **Apple-Aesthetic Visual Asset Gallery & DAM Engine for Obsidian** — Direct Eagle library integration, local Vision OCR, color palette filtering, and seamless markdown dragging.

Part of the **Crisp Series** for Obsidian by [letschips](https://github.com/letschips).

---

## ✨ Features

- 🖼️ **Masonry Gallery**: Thumbnails stream straight from disk and render in batches, so large libraries stay responsive. Newest items fill the first row; three densities.
- 🦅 **Native Eagle Library Integration**: Directly mounts your local Eagle library (`.library/images`), automatically reading folders hierarchy, color palettes, tags, and ratings without bloating your iCloud vault.
- 🔍 **Local Offline macOS Vision OCR**: Offline Chinese and English text recognition with Apple's Vision framework. The helper ships inside `main.js` (universal binary), so BRAT and manual installs get it too. Recognized text becomes searchable.
- ⚡ **Clipboard & Drop Capture**: Paste (`Cmd + V`) or drop images into the gallery to add them to your Eagle library. The real image format and size are read from the file.
- 🎨 **Filter Panel**: Filter by dominant color, aspect ratio, star rating and file format from one panel.
- 🏁 **Grayscale Inspiration Mode**: One-click monochrome toggle to strip away color and focus strictly on layout composition, typographic hierarchy, and value contrast.
- 🏷️ **Dynamic Sidebar Tag Navigator**: Aggregates all tags across your asset library for fast one-click filtering.
- 🔬 **Inspector**: Press `←` / `→` to move through the current results, `Esc` to close. Click a color swatch to copy its HEX code; set star ratings in place.
- 📝 **Notes**: Drag images into notes, or insert them at the cursor of the note you used last. Assets can also be recorded in a note's `eagle` property.
- 💎 **ANKS RAW Cards (optional)**: In vaults that use ANKS (`Topics/self-media/raw/inbox` exists), generate `RAW-YYYYMMDD-<id>.md` cards linked back to Eagle. Other vaults never see this option.

---

## 🚀 Quick Start

### 1. Open Crisp Visual
- Click the **Television (📺) icon** in Obsidian left ribbon, or
- Open the Command Palette (`Cmd + P`) and run `Crisp Visual: 打开视觉资产画廊`.

### 2. Connect Your Eagle Library
- On first launch, Crisp Visual will automatically scan and detect any `.library` in your vault or pictures folder.
- You can also go to **Settings → Crisp Visual** and select your Eagle library `images` directory.

### 3. Capture & Search
- Press `Cmd + V` anywhere in the gallery to capture your clipboard.
- Type in the search box to filter by file name, tags, or OCR-extracted text.

---

## 📦 Installation

### Method 1: Via BRAT (Recommended)
1. Install and enable the **[Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat)** community plugin.
2. Open Obsidian Settings → **BRAT** → **Add Beta plugin**.
3. Enter `letschips/crisp-visual` and click **Add Plugin**.
4. Enable **Crisp Visual** under **Community plugins**.

### Method 2: Manual Installation
1. Download the latest release (`main.js`, `manifest.json`, `styles.css`) from [Releases](https://github.com/letschips/crisp-visual/releases).
2. Create a folder named `crisp-visual` in your Obsidian vault plugins directory:
   `<VaultFolder>/.obsidian/plugins/crisp-visual/`
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Reload Obsidian (`Cmd + R`) and enable **Crisp Visual** in Settings → Community Plugins.

---

## ⚙️ Settings

| Setting | Description | Default |
| :--- | :--- | :--- |
| **Media Root Path** | Path to your Eagle library `images` folder | Auto-detected |
| **Insert Format** | Image that opens Eagle when clicked / plain image / link to Eagle | Image that opens Eagle |
| **Software License** | Single key activates all Crisp plugins (Crisp Suite / Crisp Visual) | Auto-discovered from suite |

---

## Activation and Preview

Without a valid activation, the gallery shows only an activation card and does not scan or watch the asset library. Browsing, search, import, note insertion, drag export, link copying, OCR, rating changes, topic binding, and RAW-card creation require activation.

Valid signed licenses retain offline fallback. Server-side revocation and device limits cannot be checked while offline.

## 🛠 Development

Source lives in `src/`; `main.js` is generated.

```bash
npm install
npm run build      # src/ -> main.js (embeds native/vision_ocr)
npm run check      # build, unit tests, license tests, library e2e
npm run build:ocr  # rebuild native/vision_ocr (universal) after editing the Swift source
```

## 🔒 Privacy & Software Policy

- **100% Local-First**: All image scanning, indexing, thumbnail loading, and OCR processing run entirely on your local machine. No images, notes, or prompts are ever uploaded to any cloud server.
- **Zero Cloud Leakage**: Only cryptographic license verification communicates with Cloudflare for device limit validation (`https://license.letschips.xyz/api/verify-device`), with seamless offline fallback support.

---

## 📄 License

[Crisp Proprietary License](LICENSE) © 2026 [letschips](https://github.com/letschips)
