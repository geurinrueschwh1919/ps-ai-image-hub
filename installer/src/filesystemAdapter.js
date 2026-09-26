"use strict";

class FilesystemDetector {
  constructor(provider) { this.provider = provider; }
  scan() { return this.provider && this.provider.findPhotoshopExecutables ? this.provider.findPhotoshopExecutables() : []; }
}

module.exports = { FilesystemDetector };
