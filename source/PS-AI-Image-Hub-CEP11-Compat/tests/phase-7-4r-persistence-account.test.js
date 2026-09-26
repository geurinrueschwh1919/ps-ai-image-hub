"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SecretStore } = require("../client/js/storage/secretStore");
const { PersistentSecretStore } = require("../client/js/storage/persistentSecretStore");
const { GrsAccountClient, GRS_ACCOUNT_ENDPOINTS } = require("../client/js/providers/grsAccountClient");
const { GrsProvider } = require("../client/js/providers/grsProvider");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { ProviderManager, KEY_UNCHANGED } = require("../client/js/ui/providerManager");

function memoryStorage() {
  const values = new Map();
  return { getItem(key) { return values.get(key) || null; }, setItem(key, value) { values.set(key, value); }, removeItem(key) { values.delete(key); } };
}

function fakeFs() {
  const files = new Map();
  return {
    files,
    makedir() { return { err: 0 }; }, stat() { return { err: 0 }; },
    readFile(path) { return files.has(path) ? { err: 0, data: files.get(path) } : { err: 2 }; },
    writeFile(path, data) { files.set(path, data); return { err: 0 }; }
  };
}

test("remember key off remains session-only", () => {
  const persistence = { get() { return null; }, set() { throw new Error("must not persist"); }, remove() {}, has() { return false; } };
  const store = new SecretStore({ storage: memoryStorage(), persistence });
  store.set("provider:grs:apiKey", "sk-session", { remember: false });
  assert.equal(store.get("provider:grs:apiKey"), "sk-session");
  assert.equal(store.isRemembered("provider:grs:apiKey"), false);
});

test("remember key on restores after a simulated Photoshop restart", () => {
  const fs = fakeFs();
  const persistence1 = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  const first = new SecretStore({ storage: memoryStorage(), persistence: persistence1 });
  first.set("provider:grs:apiKey", "sk-persisted", { remember: true });
  const persistence2 = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  const restarted = new SecretStore({ storage: memoryStorage(), persistence: persistence2 });
  assert.equal(restarted.get("provider:grs:apiKey"), "sk-persisted");
  assert.equal(restarted.isRemembered("provider:grs:apiKey"), true);
});

test("panel close and reopen explicitly hydrates the remembered key before Provider use", () => {
  const fs = fakeFs(), filePath = "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json";
  const first = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) });
  first.set("provider:grs:apiKey", "sk-panel-reopen", { remember: true });
  const reopened = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) });
  assert.deepEqual(reopened.hydrate(["provider:grs:apiKey"]), ["provider:grs:apiKey"]);
  assert.equal(reopened.get("provider:grs:apiKey"), "sk-panel-reopen");
});

test("persistent writes are synchronously read back and verified", () => {
  const fs = fakeFs(), persistence = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  persistence.set("key", "value");
  assert.equal(persistence.reload().key, "value");
});

function providerManagerWithSecret(secretStore, accountClient) {
  const registry = new ProviderRegistry();
  registry.register(new GrsProvider(null, { secretStore, accountClient, apiClient: {} }));
  return new ProviderManager(registry, { secretStore, providerStore: { load() { return []; }, save() {} }, providerFactory: { create() { throw new Error("not needed"); } } });
}

test("provider hydration exposes a masked saved state without exposing the key", () => {
  const fs = fakeFs(), filePath = "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json";
  const first = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) });
  first.set("provider:grs:apiKey", "sk-1234567890abcd", { remember: true });
  const restored = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) });
  restored.hydrate(["provider:grs:apiKey"]);
  const status = providerManagerWithSecret(restored).getApiKeyStatus("grs");
  assert.equal(status.hasSecret, true); assert.equal(status.remembered, true); assert.match(status.masked, /^••+/); assert.equal(status.masked.includes("sk-1234567890abcd"), false);
});

test("blank masked input with KEY_UNCHANGED cannot overwrite a restored key", () => {
  const fs = fakeFs(), persistence = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  const secrets = new SecretStore({ storage: memoryStorage(), persistence }); secrets.set("provider:grs:apiKey", "sk-unchanged", { remember: true });
  const manager = providerManagerWithSecret(secrets);
  manager.saveProviderConfig({ id: "grs", type: "grs", authType: "bearer", modelId: "nano-banana-2" }, "", { remember: true, keyAction: KEY_UNCHANGED });
  assert.equal(secrets.get("provider:grs:apiKey"), "sk-unchanged"); assert.equal(secrets.isRemembered("provider:grs:apiKey"), true);
});

test("explicit clear removes both session and persistent API Key copies", () => {
  const fs = fakeFs(), persistence = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  const secrets = new SecretStore({ storage: memoryStorage(), persistence }); secrets.set("provider:grs:apiKey", "sk-clear", { remember: true });
  const manager = providerManagerWithSecret(secrets); manager.clearProviderApiKey("grs");
  assert.equal(secrets.get("provider:grs:apiKey"), null); assert.equal(secrets.isRemembered("provider:grs:apiKey"), false);
});

test("credits lookup works with a bootstrap-restored key and no input value", async () => {
  let usedKey;
  const fs = fakeFs(), filePath = "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json";
  const first = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) }); first.set("provider:grs:apiKey", "sk-restored-credits", { remember: true });
  const restored = new SecretStore({ storage: memoryStorage(), persistence: new PersistentSecretStore({ filePath, cepFs: fs }) }); restored.hydrate(["provider:grs:apiKey"]);
  const manager = providerManagerWithSecret(restored, { async getApiKeyCredits(baseUrl, key) { usedKey = key; return { credits: 99 }; } });
  assert.equal((await manager.getGrsApiKeyCredits({ node: "global" }, "")).credits, 99); assert.equal(usedKey, "sk-restored-credits");
});

test("unchecking remember removes the persistent copy but retains the current session", () => {
  const fs = fakeFs();
  const persistence = new PersistentSecretStore({ filePath: "C:\\UserData\\PSAIImageHub\\sensitive-provider-config.json", cepFs: fs });
  const store = new SecretStore({ storage: memoryStorage(), persistence });
  store.set("provider:grs:apiKey", "sk-value", { remember: true });
  store.set("provider:grs:apiKey", "sk-value", { remember: false });
  assert.equal(store.get("provider:grs:apiKey"), "sk-value");
  assert.equal(store.isRemembered("provider:grs:apiKey"), false);
});

test("GRS getAPIKeyCredits uses the documented endpoint and parses credits", async () => {
  let request;
  const client = new GrsAccountClient({ apiClient: { async requestJson(url, options) { request = { url, options }; return { code: 0, data: { credits: 12400 }, msg: "success" }; } } });
  const result = await client.getApiKeyCredits("https://grsaiapi.com", "sk-test");
  assert.equal(request.url, "https://grsaiapi.com" + GRS_ACCOUNT_ENDPOINTS.getApiKeyCredits);
  assert.deepEqual(JSON.parse(request.options.body), { apiKey: "sk-test" });
  assert.deepEqual(result, { credits: 12400 });
});

test("credits query failure remains independent from image generation", async () => {
  const provider = new GrsProvider(null, {
    secretStore: { get() { return "sk-test"; } },
    accountClient: { async getApiKeyCredits() { throw new Error("account endpoint down"); } },
    setInterval() { return 1; }, clearInterval() {},
    apiClient: { async requestJson() { return { id: "ok", status: "succeeded", results: [{ url: "https://files.example/result.png" }] }; } }
  });
  await assert.rejects(provider.accountClient.getApiKeyCredits(), /account endpoint down/);
  const result = await provider.generate({ modelId: "nano-banana-2", prompt: "p", references: [] });
  assert.equal(result.status, "succeeded");
});

test("Account Token is not required for API key credits", async () => {
  const client = new GrsAccountClient({ apiClient: { async requestJson() { return { code: 0, data: { credits: 1 }, msg: "success" }; } } });
  assert.equal((await client.getApiKeyCredits("https://grsaiapi.com", "sk-test")).credits, 1);
});
