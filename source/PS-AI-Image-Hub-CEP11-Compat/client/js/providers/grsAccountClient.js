(function defineGrsAccountClient(root, factory) {
  "use strict";
  var errors = typeof module === "object" && module.exports ? require("../utils/errors") : root.PSAIImageHubCompat;
  var builders = typeof module === "object" && module.exports ? require("../generation/requestBuilder") : root.PSAIImageHubCompat;
  var api = factory(errors, builders);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createGrsAccountClient(errors, builders) {
  "use strict";
  var ENDPOINTS = Object.freeze({
    getApiKeyCredits: "/client/openapi/getAPIKeyCredits",
    getAccountCredits: "/client/openapi/getCredits",
    createApiKey: "/client/openapi/createAPIKey",
    updateApiKey: "/client/openapi/updateAPIKeyInfo",
    deleteApiKey: "/client/openapi/deleteAPIKey"
  });
  class GrsAccountClient {
    constructor(options) { this.apiClient = options.apiClient; }
    async getApiKeyCredits(baseUrl, apiKey) {
      if (!apiKey) throw new errors.AppError(errors.ErrorCodes.MISSING_API_KEY, "GRS API key is required.");
      var response = await this.apiClient.requestJson(builders.joinUrl(baseUrl, ENDPOINTS.getApiKeyCredits), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: apiKey }),
        timeout: 25000, timeoutContext: "connection", corsAware: true,
        diagnostics: { stage: "account", provider: "GRS", endpoint: ENDPOINTS.getApiKeyCredits }
      });
      if (!response || response.code !== 0 || !response.data || !isFinite(Number(response.data.credits))) {
        throw new errors.AppError(errors.ErrorCodes.INVALID_RESPONSE, response && response.msg || "GRS credits response is invalid.");
      }
      return { credits: Number(response.data.credits) };
    }
  }
  return { GrsAccountClient: GrsAccountClient, GRS_ACCOUNT_ENDPOINTS: ENDPOINTS };
}));
