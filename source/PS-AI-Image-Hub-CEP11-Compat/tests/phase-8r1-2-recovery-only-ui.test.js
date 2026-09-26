"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
require("../client/js/i18n/zh-CN");
require("../client/js/ui/mainPanel");
const { MainPanel, updateRecoveryAction, zhCN } = globalThis.PSAIImageHubCompat;

test("local cancel UI exposes only Recovery and no Snapshot Regenerate entry", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /id="recover-task"/);
  assert.doesNotMatch(source, /regenerate-task|handleSnapshotRegenerate|regenerateButton/);
  assert.equal(zhCN.cancelGeneration, "停止等待");
  assert.match(zhCN.statusCancelled, /已停止本地等待/);
  assert.match(zhCN.statusCancelled, /任务可能仍会继续运行并产生费用/);
});

test("Recovery action renders the original Task ID as the only post-cancel action", () => {
  const panel = {
    recoverButton: { hidden: true, textContent: "" },
    t(key, values) { return key === "recoverTask" ? "继续查询原任务 " + values.id : key; }
  };
  assert.equal(updateRecoveryAction(panel, { id: "task-A", status: "canceled_local" }), true);
  assert.equal(panel.recoverButton.hidden, false);
  assert.equal(panel.recoverButton.textContent, "继续查询原任务 task-A");
  assert.equal(updateRecoveryAction(panel, null), false);
  assert.equal(panel.recoverButton.hidden, true);
});

test("Continue Original Task uses original Task ID and never calls generation submit", async () => {
  let recoveryCalls = 0;
  let submitCalls = 0;
  const fake = {
    recoverableTask: { id: "task-A", modelId: "m", executionId: "exec-A", historyId: "history-A" },
    beginBusyOperation() {}, endBusyOperation() {}, syncRecoveryButton() {},
    restoreRecoveryInputs() { return { metadata: { prompt: "p", executionId: "exec-A", historyId: "history-A" }, mainImage: null }; },
    autoImport: { checked: false }, uiStateStore: null,
    generationManager: {
      async recoverProviderTask(providerId, taskId, options) {
        recoveryCalls += 1;
        assert.equal(providerId, "grs");
        assert.equal(taskId, "task-A");
        options.onExecution({ executionId: "exec-A" });
        return { executionId: "exec-A", images: [] };
      },
      async generateOneClick() { submitCalls += 1; }
    },
    currentUiExecutionId: null,
    handlePipelineStatus() {}, resultView: { render() {} }, statusView: { update() {} },
    historyPanel: { refresh() {} }, t(key) { return key; }
  };
  await MainPanel.prototype.handleRecover.call(fake);
  assert.equal(recoveryCalls, 1);
  assert.equal(submitCalls, 0);
});

test("History parameter restoration does not submit generation", () => {
  let submitCalls = 0;
  const select = (values) => ({ value: "", options: values.map((value) => ({ value })) });
  const fake = {
    providerManager: { getProvider() { return {}; } },
    providerSelect: { value: "" }, promptInput: { value: "" },
    aspectRatio: select(["16:9"]), imageSize: select(["2K"]),
    populateModels() {}, activateTab(tab) { assert.equal(tab, "generate"); },
    generationManager: { generateOneClick() { submitCalls += 1; } }
  };
  const originalRefresh = globalThis.PSAIImageHubCompat.refreshEnhancedSelect;
  globalThis.PSAIImageHubCompat.refreshEnhancedSelect = function noop() {};
  try {
    MainPanel.prototype.restoreHistoryEntry.call(fake, {
      provider: "grs", modelId: "gpt-image-2-vip", prompt: "restore only", aspectRatio: "16:9", imageSize: "2K"
    });
  } finally {
    globalThis.PSAIImageHubCompat.refreshEnhancedSelect = originalRefresh;
  }
  assert.equal(fake.promptInput.value, "restore only");
  assert.equal(submitCalls, 0);
});

test("snapshot metadata infrastructure remains in Recovery input restoration", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../client/js/ui/mainPanel.js"), "utf8");
  assert.match(source, /metadata\.prompt/);
  assert.match(source, /metadata\.modelId/);
  assert.match(source, /metadata\.aspectRatio/);
  assert.match(source, /metadata\.resolutionTier/);
  assert.match(source, /snapshot\.mainImage/);
  assert.match(source, /snapshot\.referenceImages/);
  assert.match(source, /metadata\.mainTarget/);
});
