"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const storeApi = require("../client/js/presets/promptPresetStore");
const { PromptPresetRegistry } = require("../client/js/presets/promptPresetRegistry");
const { PromptPresetPanel, promptPresetErrorKey } = require("../client/js/ui/promptPresetPanel");
const { PROMPT_PRESET_ERROR_CODES } = require("../client/js/presets/promptPresetNormalizer");
const { MemoryStore, createCompatibleStorage } = require("../client/js/compat/compatStorage");

const V2 = storeApi.PROMPT_PRESET_V2_STORAGE_KEY;
const V1 = storeApi.PROMPT_PRESET_STORAGE_KEY;

class Storage extends MemoryStore {
  constructor() { super(); this.failKey = ""; this.ignoreKey = ""; }
  setItem(key, value) { if (key === this.failKey) throw new Error("simulated write failure"); if (key !== this.ignoreKey) super.setItem(key, value); }
  removeItem(key) { if (key === this.failKey) throw new Error("simulated remove failure"); super.removeItem(key); }
}

function preset(id, factory) { return { id, title: id, category: "other", promptTemplate: id, factory: factory === true }; }
function seeded(options) {
  const storage = new Storage();
  const store = new storeApi.PromptPresetStore({ storage, persistent: !options || options.persistent !== false });
  store.writeState({ presets: [preset("delete-me"), preset("keep-me"), preset("factory", true)],
    favorites: ["delete-me", "keep-me"], recent: [{ id: "delete-me", appliedAt: "now" }],
    displayNames: { "delete-me": "删除", "keep-me": "保留" }, lastValues: { "delete-me": { x: 1 } },
    stack: [{ presetId: "delete-me", enabled: true, values: {} }, { presetId: "keep-me", enabled: true, values: {} }], hiddenFactoryPresetIds: [] });
  return { storage, store, registry: new PromptPresetRegistry({ store }) };
}

test("Compat atomic delete removes V2, V1, favorites, recent, stack, names and values", () => {
  const { storage, store, registry } = seeded(); registry.remove("delete-me"); const state = store.loadState();
  assert.equal(state.presets.some((item) => item.id === "delete-me"), false);
  assert.equal(state.favorites.includes("delete-me"), false); assert.equal(state.recent.length, 0);
  assert.equal(state.stack.some((item) => item.presetId === "delete-me"), false);
  assert.equal(state.displayNames["delete-me"], undefined); assert.equal(state.lastValues["delete-me"], undefined);
  assert.equal(JSON.parse(storage.getItem(V2)).presets.some((item) => item.id === "delete-me"), false);
  assert.equal(JSON.parse(storage.getItem(V1)).some((item) => item.id === "delete-me"), false);
  assert.equal(new PromptPresetRegistry({ store: new storeApi.PromptPresetStore({ storage }) }).get("delete-me"), null);
});

for (const failedKey of [V2, V1]) {
  test(`Compat failure writing ${failedKey} preserves disk, Store and Registry`, () => {
    const { storage, store, registry } = seeded(); const oldV2 = storage.getItem(V2); const oldV1 = storage.getItem(V1); storage.failKey = failedKey;
    assert.throws(() => registry.remove("delete-me"), (error) => error.code === PROMPT_PRESET_ERROR_CODES.STORAGE_WRITE_FAILED);
    assert.equal(registry.get("delete-me").id, "delete-me"); assert.equal(store.loadState().presets.some((item) => item.id === "delete-me"), true);
    assert.equal(storage.getItem(V2), oldV2); assert.equal(storage.getItem(V1), oldV1);
  });
}

test("Compat write verification failure rolls back and UI reports storage error only", () => {
  const { storage, registry } = seeded(); const oldV2 = storage.getItem(V2); storage.ignoreKey = V1;
  const messages = []; const panel = { currentLibraryPreset: registry.get("delete-me"), registry, stack: null,
    refreshCategories() { throw new Error("must not refresh"); }, refreshList() {}, renderStack() {}, setMessage(key) { messages.push(key); },
    showError(error) { messages.push(promptPresetErrorKey(error)); } };
  PromptPresetPanel.prototype.removeCurrent.call(panel);
  assert.deepEqual(messages, ["presetErrorStorageWrite"]); assert.equal(storage.getItem(V2), oldV2); assert.equal(registry.get("delete-me").id, "delete-me");
});

test("Compat factory hide/restore remains unchanged", () => {
  const { store, registry } = seeded(); registry.remove("factory"); assert.deepEqual(store.getHiddenFactoryPresetIds(), ["factory"]);
  registry.restoreAllFactories(); assert.equal(registry.get("factory").id, "factory");
});

test("Compat persistent adapter and MemoryStore fallback expose persistence truth", () => {
  const persistent = createCompatibleStorage(new MemoryStore()); assert.equal(persistent.persistent, true);
  const fallback = createCompatibleStorage({ setItem() { throw new Error("blocked"); } }); assert.equal(fallback.persistent, false);
  const store = new storeApi.PromptPresetStore({ storage: fallback.storage, persistent: fallback.persistent });
  const registry = new PromptPresetRegistry({ store }); registry.register(preset("temporary")); registry.remove("temporary");
  assert.equal(registry.wasLastDeletePersistent(), false);
});
