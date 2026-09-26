"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { parsePromptPreset, parsePromptPresetMarkers } = require("../client/js/presets/promptPresetParser");
const { PromptPresetCompiler, applyCompiledPrompt } = require("../client/js/presets/promptPresetCompiler");
const { PromptPresetStore, PROMPT_PRESET_STORAGE_KEY } = require("../client/js/presets/promptPresetStore");
const { PromptPresetRegistry } = require("../client/js/presets/promptPresetRegistry");
const { PROMPT_PRESET_ERROR_CODES } = require("../client/js/presets/promptPresetNormalizer");
const { writePresetToPrompt } = require("../client/js/ui/promptPresetPanel");
const { ProviderRegistry } = require("../client/js/providers/providerRegistry");
const { MockProvider } = require("../client/js/providers/mockProvider");
const { ProviderManager } = require("../client/js/ui/providerManager");
const { GenerationManager } = require("../client/js/generation/generationManager");

const compiler = new PromptPresetCompiler();
const root = path.resolve(__dirname, "..");
function source(name) { return fs.readFileSync(path.join(root, name), "utf8"); }
class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test("static JSON preset imports and compiles locally", () => {
  const preset = parsePromptPreset(JSON.stringify({ id: "static", title: "静态", category: "风格", promptTemplate: "电影感夜景，霓虹灯光" }));
  assert.equal(preset.sourceKind, "template");
  assert.equal(compiler.compile(preset, {}), "电影感夜景，霓虹灯光");
});

test("parameter JSON preset normalizes slider, text, textarea, toggle and select", () => {
  const preset = parsePromptPreset({ id: "params", title: "参数", promptTemplate: "主题 {{subject}}，风格 {{style}}", controls: [{ id: "strength", label: "强度", type: "slider", min: 0, max: 1, default: 0.5 }],
    fields: [{ id: "subject", label: "主题", type: "text", default: "人物" }, { id: "notes", label: "说明", type: "textarea", default: "细节" },
      { id: "style", label: "风格", type: "select", default: "cg", options: [{ value: "cg", label: "CG", text: "CG 写实" }] }],
    toggles: [{ id: "keepFace", label: "保持脸部", default: true }] });
  assert.deepEqual(preset.controls.map((item) => item.type), ["slider"]);
  assert.deepEqual(preset.fields.map((item) => item.type), ["text", "textarea", "select"]);
  assert.equal(preset.toggles[0].type, "toggle");
  assert.match(compiler.compile(preset, { subject: "模特", style: "cg", strength: 0.8, keepFace: true }), /主题 模特，风格 CG 写实/);
});

test("content nested JSON extracts @param sliders and useful structured text", () => {
  const content = { role: "氛围师", description: "增加霓虹效果", "@param:霓虹色彩": 0.5,
    "@param:霓虹色彩_desc": "0=关闭;0.5=标准霓虹;1=极致炫彩" };
  const preset = parsePromptPreset(JSON.stringify({ id: "nested", title: "霓虹", content: JSON.stringify(content) }));
  assert.equal(preset.sourceKind, "structured");
  assert.equal(preset.controls[0].id, "霓虹色彩");
  assert.match(compiler.compile(preset, { 霓虹色彩: 1 }), /极致炫彩/);
});

test("marker preset parses modules and removes a zero-value module", () => {
  const marker = ["// system_role: 表情师", "// MODULE_START:smile", "// @param:smile\": 0.5", "// @param:smile_label\": \"微笑\"", "// @param:smile_desc\": \"0=关闭;0.5=自然微笑;1=灿烂微笑\"", "// apply a natural smile", "// MODULE_END:smile"].join("\n");
  const parsed = parsePromptPreset(JSON.stringify([{ id: "marker", title: "表情", content: marker }]));
  assert.equal(parsed.sourceKind, "marker");
  assert.equal(parsePromptPresetMarkers(marker).modules.length, 1);
  assert.doesNotMatch(compiler.compile(parsed, { smile: 0 }), /natural smile/);
  assert.match(compiler.compile(parsed, { smile: 1 }), /natural smile/);
});

test("empty, invalid, unsupported and broken marker presets return stable errors", () => {
  assert.throws(() => parsePromptPreset(""), (error) => error.code === PROMPT_PRESET_ERROR_CODES.EMPTY);
  assert.throws(() => parsePromptPreset("{oops"), (error) => error.code === PROMPT_PRESET_ERROR_CODES.JSON_INVALID);
  assert.throws(() => parsePromptPreset("[]"), (error) => error.code === PROMPT_PRESET_ERROR_CODES.UNSUPPORTED);
  assert.throws(() => parsePromptPreset(JSON.stringify({ title: "broken", content: "MODULE_START:a\n@param:a: 1" })),
    (error) => error.code === PROMPT_PRESET_ERROR_CODES.MARKER_INVALID);
});

test("replace, append and append de-duplication are deterministic", () => {
  assert.deepEqual(applyCompiledPrompt("旧提示", "新提示", "replace"), { text: "新提示", duplicate: false });
  assert.deepEqual(applyCompiledPrompt("旧提示", "新提示", "append"), { text: "旧提示\n\n新提示", duplicate: false });
  assert.deepEqual(applyCompiledPrompt("旧提示\n\n新提示", "新提示", "append"), { text: "旧提示\n\n新提示", duplicate: true });
});

test("applying a preset writes the current Prompt textarea and remains editable", () => {
  const textarea = { value: "基础提示" };
  writePresetToPrompt(textarea, "灯光预设", "append");
  assert.equal(textarea.value, "基础提示\n\n灯光预设");
  textarea.value += "，用户编辑";
  assert.match(textarea.value, /用户编辑$/);
});

test("Preset Store persists locally and Registry deletes its record", () => {
  const storage = new MemoryStorage();
  const store = new PromptPresetStore({ storage });
  const registry = new PromptPresetRegistry({ store });
  const preset = parsePromptPreset({ id: "persisted", title: "持久化", promptTemplate: "文本" });
  registry.register(preset);
  assert.match(storage.getItem(PROMPT_PRESET_STORAGE_KEY), /persisted/);
  assert.equal(new PromptPresetRegistry({ store }).get("persisted").title, "持久化");
  registry.remove("persisted");
  assert.equal(new PromptPresetRegistry({ store }).get("persisted"), null);
});

test("duplicate ID or title is rejected without corrupting stored presets", () => {
  const registry = new PromptPresetRegistry({ store: new PromptPresetStore({ storage: new MemoryStorage() }) });
  registry.register(parsePromptPreset({ id: "same", title: "同名", promptTemplate: "A" }));
  assert.throws(() => registry.register(parsePromptPreset({ id: "same", title: "另一个", promptTemplate: "B" })),
    (error) => error.code === PROMPT_PRESET_ERROR_CODES.DUPLICATE);
  assert.equal(registry.list().length, 1);
});

test("preset selection is independent from Image Provider switching", () => {
  const registry = new PromptPresetRegistry({ store: new PromptPresetStore({ storage: new MemoryStorage() }) });
  registry.register(parsePromptPreset({ id: "independent", title: "独立", promptTemplate: "文本" }));
  registry.setRecentId("independent");
  const main = source("client/js/ui/mainPanel.js");
  const switchBody = main.slice(main.indexOf("handleProviderChange()"), main.indexOf("setOptions(select"));
  assert.doesNotMatch(switchBody, /promptPreset.*(?:remove|reset|clear)/i);
  assert.equal(registry.getRecentId(), "independent");
});

test("one-click generation still reads only the current Prompt and performs one Image submit", async () => {
  const imageRegistry = new ProviderRegistry(); const provider = new MockProvider({ submitDelay: 0, generationDelay: 0 }); let submits = 0;
  const generate = provider.generate.bind(provider); provider.generate = async function counted(request, context) { submits += 1; return generate(request, context); };
  imageRegistry.register(provider);
  const manager = new GenerationManager({ providerManager: new ProviderManager(imageRegistry), imageImporter: {}, t(key) { return key; } });
  const result = await manager.generateOneClick({ providerId: "mock", modelId: "mock-image-v1", prompt: "预设应用后又手动修改" });
  assert.equal(submits, 1); assert.equal(result.prompt, "预设应用后又手动修改");
});

test("History and Recovery continue to use final Prompt without preset coupling", () => {
  const history = source("client/js/ui/historyPanel.js");
  const main = source("client/js/ui/mainPanel.js");
  const recovery = source("client/js/generation/generationManager.js");
  assert.match(history, /entry\.finalPrompt \|\| entry\.prompt/);
  assert.match(main, /this\.promptInput\.value = entry\.finalPrompt \|\| entry\.prompt/);
  assert.doesNotMatch(recovery, /promptPreset|presetId|presetTitle/);
});

test("Preset runtime is local-only and contains no dynamic code execution", () => {
  const runtime = ["promptPresetNormalizer.js", "promptPresetParser.js", "promptPresetCompiler.js", "promptPresetStore.js", "promptPresetRegistry.js"]
    .map((name) => source("client/js/presets/" + name)).join("\n") + source("client/js/ui/promptPresetPanel.js");
  assert.doesNotMatch(runtime, /\beval\s*\(|\bFunction\s*\(|XMLHttpRequest|requestJson|fetch\s*\(/);
});

test("Generate UI exposes a compact collapsible preset panel with no automatic apply", () => {
  const panel = source("client/js/ui/promptPresetPanel.js");
  assert.match(panel, /<details class="prompt-preset-panel">/);
  assert.match(panel, /prompt-preset-import/); assert.match(panel, /prompt-preset-apply/);
  assert.doesNotMatch(panel, /autoApply|beforeGenerate|optimiz/i);
});

const sampleNames = ["114_灯光特效_夜景霓虹氛围.json", "表情控制.json", "颗粒附着化.json", "特效附着化.json",
  "头发优化(JSON).json", "身材优化（文字优化版，可调参数）.json", "CG写实毛发.json", "溶图.json"];
test("all eight user JSON samples import and compile without network", (context) => {
  const downloads = path.join(process.env.USERPROFILE || "", "Downloads");
  if (!sampleNames.every((name) => fs.existsSync(path.join(downloads, name)))) { context.skip("User sample files are not present on this machine."); return; }
  sampleNames.forEach((name) => {
    const raw = fs.readFileSync(path.join(downloads, name), "utf8");
    const preset = parsePromptPreset(raw, { fileName: name });
    const output = compiler.compile(preset, {});
    assert.ok(preset.title, name + " title");
    assert.ok(output.length > 20, name + " compiled text");
  });
});
