(function defineI18n(root, factory) {
  "use strict";
  var api;
  if (typeof module === "object" && module.exports) {
    api = factory(require("./zh-CN"), require("./en-US"));
    module.exports = api;
  } else {
    root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
    api = factory(root.PSAIImageHubCompat.zhCN, root.PSAIImageHubCompat.enUS);
    Object.assign(root.PSAIImageHubCompat, api);
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function createI18n(zhCN, enUS) {
  "use strict";
  var locales = { "zh-CN": zhCN, "en-US": enUS };

  function createTranslator(locale) {
    var selected = locales[locale] || locales["zh-CN"];
    var fallback = locales["zh-CN"];
    return function translate(key, replacements) {
      var value = selected[key] || fallback[key] || key;
      Object.keys(replacements || {}).forEach(function replace(name) {
        value = value.split("{" + name + "}").join(String(replacements[name]));
      });
      return value;
    };
  }

  return { createTranslator: createTranslator };
}));

