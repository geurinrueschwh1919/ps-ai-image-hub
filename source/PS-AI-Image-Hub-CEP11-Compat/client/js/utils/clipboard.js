(function defineClipboard(root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createClipboard(root) {
  "use strict";
  async function copyText(text) {
    var value = String(text || "");
    try {
      if (root.navigator && root.navigator.clipboard && typeof root.navigator.clipboard.writeText === "function") {
        await root.navigator.clipboard.writeText(value);
        return { copied: true, method: "navigator.clipboard" };
      }
    } catch (error) { /* CEP may expose a denied clipboard getter; use the legacy fallback. */ }
    if (!root.document || typeof root.document.execCommand !== "function") throw new Error("Clipboard API is unavailable.");
    var input = root.document.createElement("textarea"); input.value = value;
    if (typeof input.setAttribute === "function") input.setAttribute("readonly", "readonly");
    input.style.position = "fixed"; input.style.left = "-9999px"; input.style.top = "0"; input.style.opacity = "0";
    root.document.body.appendChild(input);
    if (typeof input.focus === "function") input.focus();
    input.select();
    if (typeof input.setSelectionRange === "function") input.setSelectionRange(0, value.length);
    try {
      if (!root.document.execCommand("copy")) throw new Error("Clipboard copy failed.");
      return { copied: true, method: "execCommand" };
    }
    finally { root.document.body.removeChild(input); }
  }
  return { copyText: copyText };
}));
