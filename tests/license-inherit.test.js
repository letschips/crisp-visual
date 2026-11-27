// 授权继承回归：库内有多张 Crisp 授权时，必须采用第一张“本地校验通过”的，
// 而不是第一张看起来像授权码的。全部用本地生成的临时密钥，不接触真实卡密，也不联网。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const { generateKeyPairSync, sign, webcrypto } = require("node:crypto");

const PLUGIN_ID = "crisp-visual";
const pair = generateKeyPairSync("ed25519");
const pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString().trim();

function code(features, extra = {}) {
  const payload = Buffer.from(JSON.stringify({
    product: "Crisp Suite", licenseId: "LOCAL-TEST", userName: "local", expiresAt: "2999-01-01T00:00:00.000Z", features, ...extra,
  })).toString("base64url");
  return `${payload}.${sign(null, Buffer.from(payload), pair.privateKey).toString("base64url")}`;
}
const forged = (features) => `${code(features).split(".")[0]}.${Buffer.alloc(64).toString("base64url")}`;

function load(requestUrl = async () => { throw new Error("no network in tests"); }) {
  const mainPath = path.join(__dirname, "..", "main.js");
  const original = fs.readFileSync(mainPath, "utf8");
  const PEM_RE = /`-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----`/;
  assert.ok(PEM_RE.test(original), "main.js 应内置一把公钥");
  const source = `${original.replace(PEM_RE, "`" + pem + "`")}\nglobalThis.__t = { normalizeLicenseCode, discoverVaultCrispLicense, verifyLicenseCode, CrispVisualLicenseManager };`;
  const module = { exports: {} };
  const quiet = { log() {}, warn() {}, error() {}, debug() {} };
  const obsidian = new Proxy({
    requestUrl,
    addIcon() {}, setIcon() {}, Platform: {},
  }, { get: (target, key) => (key in target ? target[key] : class {}) });
  const sandbox = {
    module, exports: module.exports, console: quiet, atob, btoa, crypto: webcrypto, TextDecoder, TextEncoder, Buffer,
    setTimeout, clearTimeout, structuredClone,
    require: (name) => (name === "obsidian" ? obsidian : require(name)),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: mainPath });
  return { ...sandbox.__t, PluginClass: module.exports };
}

// 真实目录结构的临时库：entries 为 [插件目录名, data.json 内容或原始字符串]。
function makeVault(t, entries, loaded = {}) {
  const basePath = fs.mkdtempSync(path.join(os.tmpdir(), "crisp-inherit-"));
  t.after(() => fs.rmSync(basePath, { recursive: true, force: true }));
  for (const [dir, data] of entries) {
    const pluginDir = path.join(basePath, ".obsidian", "plugins", dir);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, "data.json"), typeof data === "string" ? data : JSON.stringify(data));
  }
  const plugins = Object.fromEntries(Object.entries(loaded).map(([id, licenseCode]) => [id, { settings: { licenseCode } }]));
  return {
    appId: "local-fixture",
    vault: { adapter: { basePath }, configDir: ".obsidian" },
    plugins: { plugins },
    workspace: { getLeavesOfType: () => [] },
  };
}

const lib = load();

function makePlugin() {
  const plugin = { settings: { licenseCode: "" }, saves: 0 };
  plugin.saveSettings = async () => { plugin.saves += 1; };
  return plugin;
}

test("继承跳过不含本插件权限的单款码，采用后面的全家桶码", async (t) => {
  const good = code(["all"]);
  const app = makeVault(t, [["crisp-annotations", { licenseCode: code(["crisp-focus"]) }], ["crisp-reading-rail", { licenseCode: good }]]);
  assert.equal(await lib.discoverVaultCrispLicense(app), good);
});

test("已加载插件里的不适用码不会挡住磁盘上的可用码", async (t) => {
  const good = code(["crisp-visual"]);
  const app = makeVault(t, [["crisp-base", { licenseCode: good }]], { "crisp-focus": code(["crisp-focus"]) });
  assert.equal(await lib.discoverVaultCrispLicense(app), good);
});

test("继承跳过伪造签名、已过期的码，损坏的 data.json 不中断扫描", async (t) => {
  const good = code(["all"]);
  const app = makeVault(t, [
    ["crisp-a", { licenseCode: forged(["all"]) }],
    ["crisp-b", "{ this is not json"],
    ["crisp-c", { licenseCode: code(["all"], { expiresAt: "2001-01-01T00:00:00.000Z" }) }],
    ["crisp-d", { licenseCode: good }],
  ]);
  assert.equal(await lib.discoverVaultCrispLicense(app), good);
});

test("没有任何可用候选时返回 null，初始化不写入设置", async (t) => {
  const app = makeVault(t, [["crisp-a", { licenseCode: forged(["all"]) }], ["crisp-b", { licenseCode: code(["crisp-focus"]) }]]);
  assert.equal(await lib.discoverVaultCrispLicense(app), null);
  const plugin = makePlugin();
  const manager = new lib.CrispVisualLicenseManager(app, plugin);
  const result = await manager.initialize();
  assert.equal(result.valid, false);
  assert.equal(plugin.settings.licenseCode, "");
  assert.equal(manager.isEntitled(), false);
});

test("初始化时继承可用码并写入设置", async (t) => {
  const good = code(["all"]);
  const app = makeVault(t, [["crisp-a", { licenseCode: code(["crisp-focus"]) }], ["crisp-z", { licenseCode: good }]]);
  const plugin = makePlugin();
  const manager = new lib.CrispVisualLicenseManager(app, plugin);
  const result = await manager.initialize();
  assert.equal(result.valid, true, result.reason);
  assert.equal(plugin.settings.licenseCode, good);
  await manager.backgroundVerification;
  assert.equal(manager.isEntitled(), true);
});

test("不扫描自己的 data.json", async (t) => {
  const app = makeVault(t, [[PLUGIN_ID, { licenseCode: code(["all"]) }]]);
  assert.equal(await lib.discoverVaultCrispLicense(app), null);
});

// ---------------------------------------------------------------------------
// 粘贴规范化：聊天软件复制出来的卡密常带换行、空格、零宽字符和前后文字
// ---------------------------------------------------------------------------
function mangle(c) {
  const mid = Math.floor(c.length / 2);
  return `${c.slice(0, 10)}\n${c.slice(10, 30)}\r\n${c.slice(30, 50)} ${c.slice(50, 70)}\u3000${c.slice(70, 90)}\u200b${c.slice(90, mid)}\u00a0${c.slice(mid)}`;
}

test("规范化：夹杂换行、空格、全角空格、零宽字符的码与干净码等价且验签通过", async () => {
  const good = code(["all"]);
  assert.equal(lib.normalizeLicenseCode(mangle(good)), good);
  const result = await lib.verifyLicenseCode(mangle(good), "crisp-visual", null, undefined, { skipOnline: true });
  assert.equal(result.valid, true, result.reason);
});

test("规范化：带「卡密：」前后缀与尾随文字的码有效，持久化并发给服务端的都是干净码", async (t) => {
  const good = code(["all"]);
  for (const pasted of [`卡密：${good}。`, `${good}\n复制卡密发送给买家`]) {
    const bodies = [];
    const net = load(async (req) => { bodies.push(JSON.parse(req.body)); return { status: 200, json: { valid: true } }; });
    const plugin = makePlugin();
    const manager = new net.CrispVisualLicenseManager(makeVault(t, []), plugin);
    const result = await manager.verify(pasted);
    assert.equal(result.valid, true, result.reason);
    assert.equal(plugin.settings.licenseCode, good, "持久化的是规范化后的码");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].licenseCode, good, "发给服务端的是规范化后的码");
  }
});

test("规范化：垃圾输入和空字符串仍然无效，原因文字不变", async () => {
  assert.equal(lib.normalizeLicenseCode(undefined), "");
  assert.equal((await lib.verifyLicenseCode("", "crisp-visual", null, undefined, { skipOnline: true })).reason, "授权码为空");
  assert.equal((await lib.verifyLicenseCode(" \n\u200b ", "crisp-visual", null, undefined, { skipOnline: true })).reason, "授权码为空");
  assert.equal((await lib.verifyLicenseCode("随便一段文字", "crisp-visual", null, undefined, { skipOnline: true })).reason, "授权码格式无效");
  assert.equal((await lib.verifyLicenseCode("abc.def", "crisp-visual", null, undefined, { skipOnline: true })).valid, false);
});

test("规范化：干净码原样不变", () => {
  const good = code(["all"]);
  assert.equal(lib.normalizeLicenseCode(good), good);
});

test("规范化：兄弟插件 data.json 里带空白的码也能被继承，并返回干净码", async (t) => {
  const good = code(["all"]);
  const app = makeVault(t, [["crisp-a", { licenseCode: `卡密：\n${good}\n` }]]);
  assert.equal(await lib.discoverVaultCrispLicense(app), good);
});

// Crisp Pulse keeps its code under `settings`; Tempo saves `licenseKey` at the top level.
test("继承读得到 Pulse 嵌套在 settings 里的码和 Tempo 的 licenseKey", async (t) => {
  const pulse = code(["all"], { licenseId: "PULSE" });
  assert.equal(await lib.discoverVaultCrispLicense(makeVault(t, [["crisp-pulse", { settings: { licenseCode: pulse } }]])), pulse);
  const tempo = code(["all"], { licenseId: "TEMPO" });
  assert.equal(await lib.discoverVaultCrispLicense(makeVault(t, [["crisp-tempo", { licenseKey: tempo }]])), tempo);
});
