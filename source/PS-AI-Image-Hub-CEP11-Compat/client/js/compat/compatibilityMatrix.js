(function defineCompatibilityMatrix(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createCompatibilityMatrix() {
  "use strict";
  var PROFILES = {
    PS23_CEP11: { hostMajor: 23, automatedStatus: "Ready for real-world validation" },
    PS24_CEP11: { hostMajor: 24, automatedStatus: "Ready for real-world validation" },
    PS25_CEP11: { hostMajor: 25, automatedStatus: "Ready for PS25 regression validation" },
    UNKNOWN_CEP11: { hostMajor: null, automatedStatus: "Diagnostics only" },
    UNSUPPORTED_HOST: { hostMajor: null, automatedStatus: "Unsupported host" }
  };
  function getCompatibilityProfile(name) { return PROFILES[name] || PROFILES.UNKNOWN_CEP11; }
  return { COMPATIBILITY_PROFILES: PROFILES, getCompatibilityProfile: getCompatibilityProfile };
}));
