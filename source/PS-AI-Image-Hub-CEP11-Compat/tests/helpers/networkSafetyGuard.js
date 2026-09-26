"use strict";

const { AppError } = require("../../client/js/utils/errors");

function createNetworkSafetyGuard(responses) {
  const queue = (responses || []).slice();
  const calls = [];
  return {
    calls,
    async requestJson(url, options) {
      calls.push({ url, method: options && options.method, headers: options && options.headers, body: options && options.body });
      if (/api\.replicate\.com|grsaiapi\.com|grsai\.dakka\.com\.cn|\.maas\.aliyuncs\.com/i.test(String(url)) && queue.length === 0) {
        const error = new AppError("NETWORK_CALL_NOT_ALLOWED_IN_TEST", "NETWORK_CALL_NOT_ALLOWED_IN_TEST");
        error.url = url;
        throw error;
      }
      if (!queue.length) throw new AppError("NETWORK_CALL_NOT_ALLOWED_IN_TEST", "NETWORK_CALL_NOT_ALLOWED_IN_TEST");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return JSON.parse(JSON.stringify(next));
    }
  };
}

module.exports = { createNetworkSafetyGuard };
