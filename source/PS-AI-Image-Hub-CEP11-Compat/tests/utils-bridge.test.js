"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { createTranslator } = require("../client/js/i18n");
const { getByPath } = require("../client/js/utils/objectPath");
const { redact } = require("../client/js/utils/logger");
const { sanitizeProviderConfig } = require("../client/js/storage/providerStore");
const {
  serializeExtendScriptString,
  buildHostCall,
  parseBridgeResponse
} = require("../client/js/photoshop/bridgeSerialization");
const { PhotoshopBridge } = require("../client/js/photoshop/bridge");
const { AppError, ErrorCodes, toUserMessage } = require("../client/js/utils/errors");

test("CEP i18n defaults to Simplified Chinese and performs replacements", () => {
  const t = createTranslator("zh-CN");
  assert.equal(t("apiService"), "API 服务");
  assert.equal(t("generatedFrom", { prompt: "测试" }), "提示词：测试");
  assert.equal(createTranslator("missing")("settings"), "设置");
});

test("CEP object path resolver returns values and fallbacks", () => {
  assert.equal(getByPath({ data: { images: ["x"] } }, "data.images.0"), "x");
  assert.equal(getByPath({}, "missing.value", "fallback"), "fallback");
});

test("CEP logger and Provider Store remove credential fields", () => {
  const logged = redact({ apiKey: "secret", nested: { Authorization: "Bearer secret", model: "safe" } });
  assert.equal(logged.apiKey, "sec****cret");
  assert.equal(logged.nested.Authorization, "[REDACTED]");

  const stored = sanitizeProviderConfig([{ id: "x", apiKey: "secret", nested: { bearerToken: "secret", model: "m" } }]);
  assert.deepEqual(stored, [{ id: "x", nested: { model: "m" } }]);
});

test("Bridge serialization escapes arguments and rejects arbitrary functions", () => {
  assert.equal(serializeExtendScriptString('C:\\A\n"B"'), '"C:\\\\A\\n\\"B\\""');
  assert.equal(buildHostCall("importImage", ["C:\\test.png"]), 'PSAIImageHubCompatHost.importImage("C:\\\\test.png")');
  assert.equal(
    buildHostCall("importImage", ['C:\\用户 图片\\A "测试"\\结果.png']),
    'PSAIImageHubCompatHost.importImage("C:\\\\用户 图片\\\\A \\"测试\\"\\\\结果.png")'
  );
  assert.throws(
    () => serializeExtendScriptString("C:\\bad\0path.png"),
    (error) => error.code === "PATH_SERIALIZATION_FAILED"
  );
  assert.throws(() => buildHostCall("arbitraryCode", []), /not allowed/);
});

test("Bridge string serialization round-trips Chinese and Windows special path characters", () => {
  const original = 'D:\\Fixture\\PS AI (测试)\\O\'Brien\\A "结果".png';
  const serialized = serializeExtendScriptString(original);
  assert.equal(vm.runInNewContext(serialized), original);
});

test("Bridge response parser accepts success and maps host errors", () => {
  assert.equal(parseBridgeResponse('{"ok":true,"data":"25.0.0","error":null}'), "25.0.0");
  assert.throws(
    () => parseBridgeResponse('{"ok":false,"data":null,"error":{"code":"PHOTOSHOP","message":"failed"}}'),
    (error) => error.code === "PHOTOSHOP"
  );
});

test("PhotoshopBridge invokes only fixed host methods through CSInterface", async () => {
  const scripts = [];
  const csInterface = {
    evalScript(script, callback) {
      scripts.push(script);
      callback('{"ok":true,"data":{"message":"pong"},"error":null}');
    }
  };
  const bridge = new PhotoshopBridge({ csInterface });
  const result = await bridge.ping();
  assert.equal(result.message, "pong");
  assert.deepEqual(scripts, ["PSAIImageHubCompatHost.ping()"]);
});

test("PhotoshopBridge resolves a bundled asset under a Unicode CEP extension path", () => {
  const bridge = new PhotoshopBridge({
    csInterface: {
      evalScript() {},
      getSystemPath(pathType) {
        assert.equal(pathType, "extension");
        return 'C:\\用户目录\\PS AI "Hub"';
      }
    }
  });
  assert.equal(
    bridge.resolveExtensionAsset("client/assets/mock-result.png"),
    'C:\\用户目录\\PS AI "Hub"\\client\\assets\\mock-result.png'
  );
  assert.throws(
    () => bridge.resolveExtensionAsset("../outside.png"),
    (error) => error.code === "PATH_SERIALIZATION_FAILED"
  );
});

test("Bridge response parser preserves no-document and invalid-PNG host error codes", () => {
  assert.throws(
    () => parseBridgeResponse('{"ok":false,"data":null,"error":{"code":"NO_PHOTOSHOP_DOCUMENT","message":"none"}}'),
    (error) => error.code === "NO_PHOTOSHOP_DOCUMENT"
  );
  assert.throws(
    () => parseBridgeResponse('{"ok":false,"data":null,"error":{"code":"INVALID_PNG","message":"bad"}}'),
    (error) => error.code === "INVALID_PNG"
  );
});

test("No-document host errors map to a concrete Simplified Chinese message", () => {
  const t = createTranslator("zh-CN");
  const message = toUserMessage(new AppError(ErrorCodes.NO_PHOTOSHOP_DOCUMENT, "none"), t);
  assert.match(message, /当前没有打开 Photoshop 文档/);
  assert.doesNotMatch(message, /undefined|\[object Object\]/);
});
