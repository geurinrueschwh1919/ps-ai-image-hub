(function defineObjectPath(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports ? require("./errors") : root.PSAIImageHubCompat;
  var api = factory(errors);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createObjectPath(errors) {
  "use strict";
  var AppError = errors.AppError;
  var ErrorCodes = errors.ErrorCodes;
  var FORBIDDEN = { "__proto__": true, "prototype": true, "constructor": true };

  function parseObjectPath(path) {
    var text = String(path || "").trim();
    if (!text) return [];
    var tokens = [];
    var cursor = 0;
    while (cursor < text.length) {
      var remaining = text.slice(cursor);
      var match;
      if (cursor === 0) match = remaining.match(/^([A-Za-z_$][A-Za-z0-9_$]*|[0-9]+)/);
      else if (remaining.charAt(0) === ".") match = remaining.slice(1).match(/^([A-Za-z_$][A-Za-z0-9_$]*|[0-9]+)/);
      else if (remaining.charAt(0) === "[") match = remaining.match(/^\[([0-9]+)\]/);
      if (!match) throw new AppError(ErrorCodes.INVALID_JSON_PATH, "Invalid JSON path: " + text);
      var token = match[1];
      if (FORBIDDEN[token]) throw new AppError(ErrorCodes.INVALID_JSON_PATH, "Unsafe JSON path segment.");
      tokens.push(token);
      cursor += match[0].length + (remaining.charAt(0) === "." ? 1 : 0);
    }
    return tokens;
  }

  function getByPath(object, path, fallback) {
    if (!path) return object;
    var value = parseObjectPath(path).reduce(function reduce(current, key) {
      return current === null || current === undefined ? undefined : current[key];
    }, object);
    return value === undefined ? fallback : value;
  }
  return { getByPath: getByPath, parseObjectPath: parseObjectPath };
}));
