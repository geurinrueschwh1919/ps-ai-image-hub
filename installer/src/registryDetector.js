"use strict";

class RegistryDetector {
  constructor(provider) { this.provider = provider; }
  scan() { return this.provider && this.provider.findPhotoshop ? this.provider.findPhotoshop() : []; }
  csxsStatus() { return this.provider && this.provider.findCsxs ? this.provider.findCsxs() : []; }
  enableDebugMode(keys, explicitlyApproved) {
    if (!explicitlyApproved) return [];
    return (keys || []).filter((key) => key && key.exists).map((key) => this.provider.setPlayerDebugMode(key.path, 1));
  }
}

module.exports = { RegistryDetector };
