// Licensing (Ed25519 + device check). Moved verbatim from the 0.2 single-file build; the
// entitlement lives in module-private maps and visualEntitled() is the only gate.
import { Modal, Notice, requestUrl } from 'obsidian';
import fs from 'fs';
import path from 'path';
import { CRISP_VISUAL_VIEW_TYPE } from './constants.js';

// Crisp Licensing Engine (Ed25519 & Cloudflare Device Verification)
const CRISP_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAiz41HIDpD59SH3DjKnovUO+EEhTJXjvmiug/ev9t4ZQ=
-----END PUBLIC KEY-----`;

const CRISP_LICENSE_PRODUCTS = [
  "Crisp Suite",
  "Crisp Organize",
  "Crisp ASR",
  "Crisp Annotations",
  "Crisp File Explorer",
  "Crisp Focus",
  "Crisp Reading Rail",
  "Crisp Base",
  "Crisp Visual",
  "Crisp Recall",
  "Crisp DSH"
];

function base64UrlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  const padded = pad ? base64 + "=".repeat(4 - pad) : base64;
  const raw = atob(padded);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

function getCryptoSubtle(windowObj = window) {
  return windowObj && windowObj.crypto && windowObj.crypto.subtle
    ? windowObj.crypto.subtle
    : null;
}

// WebCrypto is taken once at load: replacing crypto.subtle later does not reach the license check.
const VISUAL_SUBTLE = (() => {
  try {
    const subtle = getCryptoSubtle(typeof window !== "undefined" ? window : globalThis) || globalThis.crypto?.subtle || null;
    return subtle ? Object.freeze({ importKey: subtle.importKey.bind(subtle), verify: subtle.verify.bind(subtle) }) : null;
  } catch (e) { return null; }
})();
let VISUAL_SUBTLE_CHECK = null;
// A verifier that accepts an all-zero signature is not a real verifier; no license is trusted then.
function visualSubtleTrusted() {
  VISUAL_SUBTLE_CHECK ||= (async () => {
    if (!VISUAL_SUBTLE) return false;
    try {
      const key = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
      const accepted = await VISUAL_SUBTLE.verify("Ed25519", key, new Uint8Array(64), new TextEncoder().encode("crisp-visual/self-test"));
      return accepted === false;
    } catch (e) { return false; }
  })();
  return VISUAL_SUBTLE_CHECK;
}

async function importEd25519PublicKey(pem) {
  const subtle = VISUAL_SUBTLE;
  if (!subtle) {
    throw new Error("当前 Obsidian 环境不支持 WebCrypto Ed25519");
  }
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const der = base64UrlToUint8Array(pemContents);
  return await subtle.importKey(
    "spki",
    der.buffer,
    { name: "Ed25519" },
    true,
    ["verify"]
  );
}

/**
 * Chat apps mangle long codes when they are copied: line breaks, spaces (incl. full-width/NBSP),
 * zero-width characters, and surrounding text such as "卡密：…。". Returns the bare code.
 */
function normalizeLicenseCode(input) {
  if (typeof input !== "string") return "";
  const compact = input.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
  const match = compact.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
  return match ? match[0] : compact;
}

// 库内其它 Crisp 插件保存的授权码，按「已加载插件 → 磁盘 data.json」顺序去重收集。
function collectVaultCrispLicenseCandidates(app) {
  if (!app) return [];
  const seen = new Set();
  const candidates = [];
  const add = (code) => {
    if (typeof code !== 'string') return;
    const trimmed = normalizeLicenseCode(code);
    if (!trimmed.includes('.') || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };
  for (const [pid, instance] of Object.entries(app.plugins?.plugins || {})) {
    if (!pid.startsWith('crisp-') || pid === 'crisp-visual') continue;
    add(instance?.settings?.licenseCode);
    add(instance?.options?.licenseCode);
    add(instance?.licenseKey);
  }
  try {
    const basePath = app.vault?.adapter?.basePath || (app.vault?.adapter?.getBasePath ? app.vault.adapter.getBasePath() : '');
    const configDir = app.vault?.configDir || ".obsidian";
    const pluginsDir = basePath ? path.join(basePath, configDir, "plugins") : "";
    if (pluginsDir && fs.existsSync(pluginsDir)) {
      for (const d of fs.readdirSync(pluginsDir)) {
        if (!d.startsWith('crisp-') || d === 'crisp-visual') continue;
        const dataPath = path.join(pluginsDir, d, 'data.json');
        if (!fs.existsSync(dataPath)) continue;
        try {
          const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
          add(data?.licenseCode || data?.licenseKey || data?.license);
          // Crisp Pulse keeps its settings nested under `settings`.
          add(data?.settings?.licenseCode || data?.settings?.licenseKey);
        } catch (e) {
          // 单个损坏的 data.json 不影响其余候选
        }
      }
    }
  } catch (e) {
    // Ignore discovery error
  }
  return candidates;
}

// 返回一张对本插件确实可用的授权码，找不到则返回 null。候选只做本地校验（不增加在线请求），
// 因此一张作用域不含 Visual、已过期或签名无效的码不会再挡住后面可用的全家桶码。
async function discoverVaultCrispLicense(app) {
  for (const code of collectVaultCrispLicenseCandidates(app)) {
    const local = await verifyLicenseCode(code, 'crisp-visual', app, window, { skipOnline: true });
    if (local.valid) return code;
  }
  return null;
}

async function verifyLicenseCode(licenseCode, targetPluginId = "crisp-visual", app = null, windowObj = window, options = {}) {
  const trimmed = normalizeLicenseCode(licenseCode);
  if (!trimmed) return { valid: false, reason: "授权码为空" };
  const parts = trimmed.split(".");
  if (parts.length !== 2) return { valid: false, reason: "授权码格式无效" };
  const [payloadBase64, signatureBase64] = parts;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadBase64));
    const payload = JSON.parse(payloadJson);
    if (!payload || typeof payload !== "object") {
      return { valid: false, reason: "授权数据无效" };
    }
    if (!CRISP_LICENSE_PRODUCTS.includes(payload.product)) {
      return { valid: false, reason: "授权码不属于 Crisp 系列插件" };
    }
    const features = Array.isArray(payload.features) ? payload.features : [];
    if (!features.includes("all") && !features.includes(targetPluginId)) {
      return { valid: false, reason: `该授权码未包含 ${targetPluginId} 权限` };
    }
    if (payload.expiresAt) {
      const expiresAt = new Date(payload.expiresAt).getTime();
      if (!Number.isFinite(expiresAt)) {
        return { valid: false, reason: "授权到期时间无效" };
      }
      if (expiresAt < Date.now()) {
        return { valid: false, reason: `授权已于 ${String(payload.expiresAt).split("T")[0]} 到期` };
      }
    }
    if (!(await visualSubtleTrusted())) return { valid: false, reason: "当前环境无法验证签名" };
    const publicKey = await importEd25519PublicKey(CRISP_PUBLIC_KEY_PEM);
    const isValid = await VISUAL_SUBTLE.verify(
      "Ed25519",
      publicKey,
      base64UrlToUint8Array(signatureBase64),
      new TextEncoder().encode(payloadBase64)
    );
    if (isValid !== true) return { valid: false, reason: "授权签名无效" };
    if (options.skipOnline) return { valid: true, payload, source: "offline" };

    try {
      const deviceId = app?.appId || (app?.vault?.getName ? "vault-" + encodeURIComponent(app.vault.getName()) : "device-default");
      const res = await Promise.race([
        requestUrl({
          url: "https://license.letschips.xyz/api/verify-device",
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            licenseCode: trimmed,
            deviceId: deviceId,
            action: "activate",
            pluginId: targetPluginId
          }),
          throw: false
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("Crisp license check timeout")), 2500))
      ]);

      let cloudResult = null;
      try {
        cloudResult = res.json;
      } catch {
        cloudResult = null;
      }

      // 1. 明确的服务端业务拒绝（200/400/401/403 且带有明确的 valid: false）
      const isAuthDenial =
        (res.status === 200 || res.status === 400 || res.status === 401 || res.status === 403) &&
        cloudResult !== null &&
        cloudResult.valid === false;

      if (isAuthDenial) {
        return {
          valid: false,
          reason: cloudResult?.reason || "授权已被服务端拒绝或设备数已达上限"
        };
      }

      // 2. 服务端明确批准（200 OK 且 valid: true）
      if (res.status === 200 && cloudResult && cloudResult.valid === true) {
        return { valid: true, payload, message: cloudResult.message, source: "online" };
      }

      // 其余情况（404/408/429/5xx、网关故障等）均视为服务不可用，降级离线可用
      if (res.status >= 400) {
        console.warn(`[Crisp Visual] License server unavailable (status ${res.status}), offline fallback`);
      }
    } catch (netErr) {
      return { valid: true, payload, message: "离线验证成功", source: "offline" };
    }

    return { valid: true, payload, message: "离线验证成功", source: "offline" };
  } catch (e) {
    return { valid: false, reason: `解析授权码失败: ${e.message}` };
  }
}

// Entitlement lives in module-private maps; the manager's status is for display only, so
// replacing fields or prototype methods cannot grant access.
const VISUAL_LICENSE_STATE = new WeakMap();  // manager -> { expiry } when verified
const VISUAL_LICENSE_TIMERS = new WeakMap();
const VISUAL_LICENSE_OWNER = new WeakMap();  // plugin -> manager

function visualManagerActive(manager) {
  const state = manager ? VISUAL_LICENSE_STATE.get(manager) : null;
  if (!state) return false;
  if (state.expiry === null || state.expiry > Date.now()) return true;
  VISUAL_LICENSE_STATE.delete(manager);
  manager.status = { valid: false, reason: "授权已到期，请重新激活" };
  return false;
}

function scheduleVisualExpiry(manager) {
  clearTimeout(VISUAL_LICENSE_TIMERS.get(manager));
  VISUAL_LICENSE_TIMERS.delete(manager);
  const state = VISUAL_LICENSE_STATE.get(manager);
  if (!state || state.expiry === null) return;
  const timer = setTimeout(() => {
    if (!visualManagerActive(manager)) manager.renderLicenseState();
    else scheduleVisualExpiry(manager);
  }, Math.min(0x7fffffff, Math.max(1, state.expiry - Date.now() + 10)));
  timer?.unref?.();
  VISUAL_LICENSE_TIMERS.set(manager, timer);
}

function setVisualLicense(manager, result) {
  if (result?.valid === true) {
    const time = result.payload?.expiresAt ? new Date(result.payload.expiresAt).getTime() : NaN;
    VISUAL_LICENSE_STATE.set(manager, { expiry: Number.isFinite(time) ? time : null });
  } else {
    VISUAL_LICENSE_STATE.delete(manager);
  }
  scheduleVisualExpiry(manager);
  // Display accessors must never influence the trusted verification result.
  manager.status = { ...result };
}

/** The single gate every feature goes through. */
function visualEntitled(plugin) {
  if (!plugin || (typeof plugin !== "object" && typeof plugin !== "function")) return false;
  return visualManagerActive(VISUAL_LICENSE_OWNER.get(plugin));
}

function visualLicenseManagerFor(plugin) {
  let manager = VISUAL_LICENSE_OWNER.get(plugin);
  if (!manager) {
    manager = new CrispVisualLicenseManager(plugin.app, plugin);
    VISUAL_LICENSE_OWNER.set(plugin, manager);
  }
  plugin.licenseManager = manager;
  return manager;
}

class CrispVisualLicenseManager {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.status = { valid: false, reason: "尚未验证" };

    this.verificationId = 0;
    this.backgroundVerification = null;
  }

  isEntitled() {
    return visualManagerActive(this);
  }

  getStatus() {
    visualManagerActive(this);
    return this.status;
  }

  async initialize() {
    const id = ++this.verificationId;
    const code = normalizeLicenseCode(this.plugin.settings?.licenseCode) || (await discoverVaultCrispLicense(this.app)) || "";
    const result = await verifyLicenseCode(code, "crisp-visual", this.app, window, { skipOnline: true });
    if (id !== this.verificationId) return { valid: false, reason: "授权校验已被更新" };
    setVisualLicense(this, result);
    if (result.valid) {
      this.plugin.settings.licenseCode = code;
      this.backgroundVerification = this.verify(code);
    }
    return result;
  }

  clear() {
    ++this.verificationId;
    setVisualLicense(this, { valid: false, reason: "已手动清除激活" });
    this.renderLicenseState();
  }

  renderLicenseState() {
    // Views re-check visualEntitled() themselves; this only tells them to look again.
    for (const leaf of this.app.workspace.getLeavesOfType(CRISP_VISUAL_VIEW_TYPE)) {
      leaf.view?.onLicenseChange?.();
    }
  }

  async verify(code = this.plugin.settings?.licenseCode) {
    const id = ++this.verificationId;
    const wasEntitled = visualManagerActive(this);
    let targetCode = normalizeLicenseCode(code);
    if (!targetCode) {
      const discovered = await discoverVaultCrispLicense(this.app);
      if (discovered) targetCode = discovered;
    }
    const result = await verifyLicenseCode(targetCode, "crisp-visual", this.app);
    if (id !== this.verificationId) return { valid: false, reason: "授权校验已被更新" };
    setVisualLicense(this, result);
    if (wasEntitled !== visualManagerActive(this)) this.renderLicenseState();
    if (result.valid) {
      this.plugin.settings.licenseCode = targetCode;
      if (result.source === "online") {
        this.plugin.settings.licenseLastOnlineAt = Date.now();
      }
      await this.plugin.saveSettings();
    }
    return result;
  }
}

class CrispVisualActivationModal extends Modal {
  constructor(app, plugin, onActivated) {
    super(app);
    this.plugin = plugin;
    this.onActivated = onActivated;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('crisp-visual-activation-modal');

    contentEl.createEl('h2', { text: '激活 Crisp Visual', cls: 'crisp-visual-modal-title' });
    contentEl.createEl('p', {
      text: '输入 Crisp Suite 或 Crisp Visual 授权码。',
      cls: 'crisp-visual-modal-desc'
    });

    const inputWrap = contentEl.createDiv({ cls: 'crisp-visual-modal-input-wrap' });
    const input = inputWrap.createEl('input', {
      type: 'password',
      placeholder: '粘贴 Crisp 授权码 (xxxx.xxxx)...',
      cls: 'crisp-visual-modal-input'
    });

    const btnRow = contentEl.createDiv({ cls: 'crisp-visual-modal-actions' });
    const activateBtn = btnRow.createEl('button', { text: '立即激活', cls: 'mod-cta' });
    const cancelBtn = btnRow.createEl('button', { text: '取消' });

    cancelBtn.addEventListener('click', () => this.close());
    activateBtn.addEventListener('click', async () => {
      const code = normalizeLicenseCode(input.value);
      if (!code) {
        new Notice('请输入有效的 Crisp 授权码');
        return;
      }
      activateBtn.setAttr('disabled', 'true');
      activateBtn.setText('验证中...');
      const res = await this.plugin.activateLicense(code);
      if (res.valid) {
        new Notice('Crisp Visual 已激活');
        this.close();
        if (this.onActivated) this.onActivated();
      } else {
        activateBtn.removeAttribute('disabled');
        activateBtn.setText('立即激活');
        new Notice(`激活失败：${res.reason || '授权码无效'}`);
      }
    });

    const buyLink = contentEl.createEl('div', { cls: 'crisp-visual-modal-footer' });
    buyLink.createSpan({ text: '一码激活全部 Crisp 插件' });
    buyLink.createEl('a', { text: '前往小红书 letschips 获取', href: 'https://xhslink.cn/m/3MwtKu4822b', attr: { target: '_blank', rel: 'noopener noreferrer' } });
  }

  onClose() {
    this.contentEl.empty();
  }
}

export {
  CRISP_PUBLIC_KEY_PEM,
  verifyLicenseCode,
  discoverVaultCrispLicense,
  visualEntitled,
  visualLicenseManagerFor,
  setVisualLicense,
  VISUAL_LICENSE_TIMERS,
  VISUAL_LICENSE_OWNER,
  CrispVisualLicenseManager,
  CrispVisualActivationModal
};
