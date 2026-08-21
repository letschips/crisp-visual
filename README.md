# Crisp Visual

> **Apple-Aesthetic Visual Asset Gallery & DAM Engine for Obsidian** — Direct Eagle library integration, local Vision OCR, color palette filtering, and seamless markdown dragging.

Part of the **Crisp Series** for Obsidian by [letschips](https://github.com/letschips).

---

## ✨ Features

- 🖼️ **Apple-Aesthetic Masonry Gallery**: High-performance multi-column image and GIF gallery with fluid hover animations, resolution badges, and smooth dark/light theme support.
- 🦅 **Native Eagle Library Integration**: Directly mounts your local Eagle library (`.library/images`), automatically reading folders hierarchy, color palettes, tags, and ratings without bloating your iCloud vault.
- 🔍 **Local Offline macOS Vision OCR**: High-speed offline Chinese and English text extraction powered by Apple native Vision framework (`VNRecognizeTextRequest`), enabling instantaneous ad-hoc search indexing across all visual assets.
- ⚡ **Instant Clipboard & Drop Capture**: Press `Cmd + V` in the gallery to instantly save screenshots or copied images into your library with automatic dimensions detection and Eagle ID assignment.
- 🎨 **Color & Multi-Dimensional Filtering**: Filter by dominant color groups (Red, Orange, Yellow, Green, Blue, Purple, Dark), aspect ratios (16:9, 3:4, 1:1, Banner), file format, and star ratings.
- 🏁 **Grayscale Inspiration Mode**: One-click monochrome toggle to strip away color and focus strictly on layout composition, typographic hierarchy, and value contrast.
- 🏷️ **Dynamic Sidebar Tag Navigator**: Aggregates all tags across your asset library for fast one-click filtering.
- 🔬 **Inspector Modal with Keyboard Roaming**: Press `←` and `→` arrow keys to seamlessly navigate through your library, `Escape` to close, click color swatches to instantly copy HEX codes, and adjust star ratings on the fly.
- 📝 **Bidirectional Markdown & Note Binding**: Drag and drop images directly into notes, insert with customizable Markdown syntax, or bind visual assets to active topic notes.
- 💎 **ANKS RAW Knowledge Cards**: Generate structured `RAW-YYYYMMDD-<id>.md` insight cards with reciprocal Eagle URI links for downstream knowledge distillation.

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
| **Insert Format** | Default syntax when inserting images: `Clickable Markdown` / `Standard Markdown` / `Raw URI Link` | `Clickable Markdown` |
| **Software License** | Single key activates all Crisp plugins (Crisp Suite / Crisp Visual) | Auto-discovered from suite |

---

## 🔒 Privacy & Software Policy

- **100% Local-First**: All image scanning, indexing, thumbnail loading, and OCR processing run entirely on your local machine. No images, notes, or prompts are ever uploaded to any cloud server.
- **Zero Cloud Leakage**: Only cryptographic license verification communicates with Cloudflare for device limit validation (`https://crisp-license.helloherve-xsn.workers.dev/api/verify-device`), with seamless offline fallback support.

---

## 📄 License

[MIT License](LICENSE) © 2026 [letschips](https://github.com/letschips)
