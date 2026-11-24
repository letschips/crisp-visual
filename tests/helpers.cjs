// Loads the built main.js with a stubbed `obsidian` module and a minimal DOM double.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

class FakeEl {
  constructor(tag = 'div', opts = {}) {
    this.tagName = tag.toUpperCase();
    this.classList = new Set(String(opts.cls || '').split(/\s+/).filter(Boolean));
    this.children = [];
    this.parent = null;
    this.attrs = { ...(opts.attr || {}) };
    this.text = opts.text || '';
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    this.dataset = {};
    this.listeners = {};
    this.scrollTop = 0;
    this.clientWidth = 0;
    this.value = '';
    if (opts.type) this.attrs.type = opts.type;
  }
  get isConnected() { return true; }
  get className() { return [...this.classList].join(' '); }
  set className(v) { this.classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
  createEl(tag, opts = {}) { const el = new FakeEl(tag, opts); el.parent = this; this.children.push(el); return el; }
  createDiv(opts = {}) { return this.createEl('div', opts); }
  createSpan(opts = {}) { return this.createEl('span', opts); }
  empty() { this.children = []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
  after(el) { el.remove(); el.parent = this.parent; const list = this.parent.children; list.splice(list.indexOf(this) + 1, 0, el); }
  prepend(el) { el.parent = this; this.children.unshift(el); }
  addClass(c) { this.classList.add(c); }
  removeClass(c) { this.classList.delete(c); }
  toggleClass(c, on) { if (on) this.classList.add(c); else this.classList.delete(c); }
  hasClass(c) { return this.classList.has(c); }
  setText(t) { this.text = t; }
  setAttr(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== fn); }
  closest(sel) {
    for (let el = this; el; el = el.parent) if (sel.split(',').some(s => el.tagName === s.trim().toUpperCase())) return el;
    return null;
  }
  scrollTo({ top }) { this.scrollTop = top; }
  contains(el) { for (let e = el; e; e = e.parent) if (e === this) return true; return false; }
  findAll(cls) {
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.classList.has(cls)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelectorAll(sel) { return this.findAll(sel.replace(/^\./, '')); }
  set innerHTML(v) { this.html = v; }
}

const notices = [];
class TFolder {}

function obsidianStub() {
  class Base {}
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf?.app;
      this.containerEl = new FakeEl();
      this.contentEl = this.containerEl.createDiv();
    }
  }
  class Modal {
    constructor(app) {
      this.app = app;
      this.modalEl = new FakeEl();
      this.titleEl = new FakeEl();
      this.contentEl = new FakeEl();
      this.scope = { keys: [], register: (mods, key, fn) => this.scope.keys.push([key, fn]) };
    }
    open() { this.isOpen = true; this.onOpen?.(); }
    close() { this.isOpen = false; this.onClose?.(); }
  }
  class Notice { constructor(message) { notices.push(message); } }
  class Menu {
    constructor() { this.items = []; }
    addItem(cb) {
      const item = { title: '', setTitle(t) { this.title = t; return this; }, setIcon() { return this; }, onClick(fn) { this.run = fn; return this; } };
      cb(item);
      this.items.push(item);
      return this;
    }
    addSeparator() { return this; }
    showAtMouseEvent() { Menu.last = this; }
  }
  return {
    Plugin: Base, PluginSettingTab: Base, Setting: Base, ItemView, Modal, Notice, Menu, TFolder,
    Platform: { resourcePathPrefix: 'app://test/', isMacOS: true },
    addIcon() {}, setIcon() {}, requestUrl: async () => ({ json: {} })
  };
}

// Test-only hook into the module-private license state.
const ENTITLE_SUFFIX = 'module.exports.__entitle = (target, on = true) => { const manager = visualLicenseManagerFor(target); setVisualLicense(manager, on ? { valid: true, payload: { product: "Crisp Suite", features: ["all"] } } : { valid: false }); return target; };';

function loadPlugin(suffix = '') {
  const pluginPath = path.resolve(__dirname, '..', 'main.js');
  const stub = obsidianStub();
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'obsidian') return stub;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const mod = new Module(pluginPath, module);
    mod.filename = pluginPath;
    mod.paths = Module._nodeModulePaths(path.dirname(pluginPath));
    mod._compile(`${fs.readFileSync(pluginPath, 'utf8')}\n${ENTITLE_SUFFIX}\n${suffix}`, pluginPath);
    mod.exports.__obsidian = stub;
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

globalThis.createSpan = opts => new FakeEl('span', opts);
globalThis.createDiv = opts => new FakeEl('div', opts);

module.exports = { FakeEl, loadPlugin, notices, ENTITLE_SUFFIX };
