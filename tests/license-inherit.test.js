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

function load() {
  const mainPath = path.join(__dirname, "..", "main.js");
  const original = fs.readFileSync(mainPath, "utf8");
  const PEM_RE = /`-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----`/;
  assert.ok(PEM_RE.test(original), "main.js 应内置一把公钥");
  const source = `${original.replace(PEM_RE, "`" + pem + "`")}\nglobalThis.__t = { discoverVaultCrispLicense, verifyLicenseCode, CrispVisualLicenseManager };`;
  const module = { exports: {} };
  const quiet = { log() {}, warn() {}, error() {}, debug() {} };
  const obsidian = new Proxy({
    requestUrl: async () => { throw new Error("no network in tests"); },
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
