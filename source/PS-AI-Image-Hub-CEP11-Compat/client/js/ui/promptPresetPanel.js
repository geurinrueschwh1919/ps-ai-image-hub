(function definePromptPresetPanel(root, factory) {
  "use strict";
  var compiler = typeof module === "object" && module.exports ? require("../presets/promptPresetCompiler") : root.PSAIImageHubCompat;
  var normalizer = typeof module === "object" && module.exports ? require("../presets/promptPresetNormalizer") : root.PSAIImageHubCompat;
  var pack = typeof module === "object" && module.exports ? require("../presets/promptPresetPack") : root.PSAIImageHubCompat;
  var zip = typeof module === "object" && module.exports ? require("../presets/promptPresetZip") : root.PSAIImageHubCompat;
  var base64 = typeof module === "object" && module.exports ? require("../utils/base64") : root.PSAIImageHubCompat;
  var api = factory(root, compiler, normalizer, pack, zip, base64);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createPromptPresetPanel(root, compilerApi, normalizer, packApi, zipApi, base64Api) {
  "use strict";
  var CODES = normalizer.PROMPT_PRESET_ERROR_CODES;
  var FAVORITES_CATEGORY_KEY = "**favorites**";

  function fileName(path) { var parts = String(path || "").split(/[\\/]/); return parts[parts.length - 1] || "preset.json"; }
  function option(value, label) { var item = document.createElement("option"); item.value = value; item.textContent = label; return item; }
  function errorKey(error) {
    var keys = {};
    keys[CODES.EMPTY] = "presetErrorEmpty"; keys[CODES.JSON_INVALID] = "presetErrorJsonInvalid";
    keys[CODES.UNSUPPORTED] = "presetErrorUnsupported"; keys[CODES.REQUIRED_FIELD] = "presetErrorRequiredField";
    keys[CODES.MARKER_INVALID] = "presetErrorMarkerInvalid"; keys[CODES.COMPILE_FAILED] = "presetErrorCompileFailed";
    keys[CODES.DUPLICATE] = "presetErrorDuplicate"; keys[CODES.NOT_FOUND] = "presetErrorNotFound";
    keys[CODES.FILE_TOO_LARGE] = "presetErrorFileTooLarge"; keys[CODES.PACK_INVALID] = "presetErrorPackInvalid";
    keys[CODES.ZIP_INVALID] = "presetErrorZipInvalid";
    keys[CODES.LIMIT_EXCEEDED] = "presetErrorLimitExceeded";
    return keys[error && error.code] || "presetErrorUnknown";
  }
  function writePresetToPrompt(textarea, compiled, mode) {
    var applied = compilerApi.applyCompiledPrompt(textarea && textarea.value || "", compiled, mode);
    if (textarea) textarea.value = applied.text;
    return applied;
  }
  function saveDialogPath(result) {
    if (!result || result.err !== 0 || !result.data) return "";
    return String(Array.isArray(result.data) ? result.data[0] || "" : result.data || "");
  }
  function categoryLabel(t, category) {
    var key = "promptPresetCategory_" + String(category || "other"), translated = t(key);
    return translated === key ? String(category || "other") : translated;
  }
  function favoriteButtonState(t, favorite) {
    return favorite ? { label: t("promptPresetFavorited"), title: t("promptPresetUnfavoriteHint") }
      : { label: t("promptPresetFavorite"), title: t("promptPresetFavoriteHint") };
  }
  function debounce(callback, delayMs, timers) {
    var timer = null, api = timers || root;
    function debounced() {
      var args = arguments, context = this;
      if (timer !== null && api.clearTimeout) api.clearTimeout(timer);
      if (!api.setTimeout) { callback.apply(context, args); return; }
      timer = api.setTimeout(function invoke() { timer = null; callback.apply(context, args); }, delayMs);
    }
    debounced.cancel = function cancel() { if (timer !== null && api.clearTimeout) api.clearTimeout(timer); timer = null; };
    return debounced;
  }
  function replaceOptions(select, options) {
    select.innerHTML = "";
    var fragment = document.createDocumentFragment ? document.createDocumentFragment() : null;
    var target = fragment || select;
    options.forEach(function append(item) { target.appendChild(item); });
    if (fragment) select.appendChild(fragment);
  }

  class PromptPresetPanel {
    constructor(container, options) {
      var settings = options || {};
      this.container = container; this.registry = settings.registry; this.stack = settings.stack || null;
      this.compiler = settings.compiler || new compilerApi.PromptPresetCompiler(); this.promptInput = settings.promptInput;
      this.t = settings.t; this.cepFs = settings.cepFs || root.cep && root.cep.fs;
      this.base64Encoding = settings.base64Encoding || root.cep && root.cep.encoding && root.cep.encoding.Base64;
      this.hasMainImage = settings.hasMainImage || function noMainImage() { return false; };
      this.onApplied = settings.onApplied || function noop() {};
      this.searchDebounceMs = typeof settings.searchDebounceMs === "number" ? settings.searchDebounceMs : 200;
      this.timerApi = settings.timerApi || root;
      this.currentValues = {}; this.selectedStackId = "";
      this.lastAppliedMetadata = { presetIds: [], presetTitles: [] };
    }
    mount() {
      this.container.innerHTML = '<details class="prompt-preset-panel"><summary>' + this.t("promptPresetTitle") + '</summary>' +
        '<div class="prompt-preset-body"><input id="prompt-preset-search" type="search" placeholder="' + this.t("promptPresetSearch") + '" />' +
        '<div class="prompt-preset-library-row"><select id="prompt-preset-category"></select><select id="prompt-preset-select"></select></div>' +
        '<div id="prompt-preset-recent" class="prompt-preset-recent"></div>' +
        '<div class="prompt-preset-toolbar"><button id="prompt-preset-favorite" class="compact-button prompt-preset-favorite" type="button" disabled>' + this.t("promptPresetFavorite") + '</button>' +
        '<span id="prompt-preset-type" class="preset-type-badge" hidden></span><button id="prompt-preset-add" class="compact-button" type="button" disabled>' + this.t("promptPresetAddToStack") + '</button></div>' +
        '<div class="prompt-preset-rename"><input id="prompt-preset-display-name" type="text" placeholder="' + this.t("promptPresetLocalName") + '" />' +
        '<button id="prompt-preset-rename" class="compact-button" type="button">' + this.t("rename") + '</button><button id="prompt-preset-reset-name" class="compact-button" type="button">' + this.t("restoreOriginalName") + '</button></div>' +
        '<div class="prompt-preset-actions"><button id="prompt-preset-import" class="compact-button" type="button">' + this.t("promptPresetImport") + '</button>' +
        '<button id="prompt-preset-import-zip" class="compact-button" type="button">' + this.t("promptPresetImportZip") + '</button>' +
        '<button id="prompt-preset-export" class="compact-button" type="button">' + this.t("promptPresetExport") + '</button>' +
        '<button id="prompt-preset-export-all" class="compact-button" type="button">' + this.t("promptPresetExportAll") + '</button>' +
        '<button id="prompt-preset-remove" class="compact-button" type="button">' + this.t("promptPresetDeleteLibrary") + '</button>' +
        '<button id="prompt-preset-restore-factory" class="compact-button" type="button">' + this.t("promptPresetRestoreFactory") + '</button></div>' +
        '<div class="field-label">' + this.t("promptPresetCurrentStack") + '</div><div id="prompt-preset-stack" class="prompt-preset-stack"></div>' +
        '<label><span class="field-label">' + this.t("promptPresetApplyMode") + '</span><select id="prompt-preset-apply-mode"><option value="replace">' + this.t("promptPresetReplace") + '</option><option value="append">' + this.t("promptPresetAppend") + '</option></select></label>' +
        '<p id="prompt-preset-description" class="muted" hidden></p><p id="prompt-preset-usage-hint" class="muted" hidden></p><p id="prompt-preset-main-hint" class="muted" hidden></p>' +
        '<div id="prompt-preset-controls" class="prompt-preset-controls" hidden></div>' +
        '<button id="prompt-preset-apply" class="secondary-button" type="button" disabled>' + this.t("promptPresetApplyStack") + '</button>' +
        '<p id="prompt-preset-message" class="prompt-preset-message muted" hidden></p>' +
        '<div id="prompt-preset-zip-review" class="prompt-preset-zip-review" role="dialog" aria-modal="true" aria-labelledby="prompt-preset-zip-review-title" hidden>' +
        '<div class="prompt-preset-zip-dialog"><strong id="prompt-preset-zip-review-title">' + this.t("promptPresetZipScanTitle") + '</strong>' +
        '<dl class="prompt-preset-zip-stats">' +
        '<div><dt>' + this.t("promptPresetZipJsonFiles") + '</dt><dd data-zip-stat="jsonFileCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipRecognized") + '</dt><dd data-zip-stat="recognizedCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipImportable") + '</dt><dd data-zip-stat="importableCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipFailures") + '</dt><dd data-zip-stat="failureCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipDuplicateIds") + '</dt><dd data-zip-stat="duplicateIdCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipDuplicateTitles") + '</dt><dd data-zip-stat="duplicateTitleCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipParameterized") + '</dt><dd data-zip-stat="parameterizedCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipWithReferences") + '</dt><dd data-zip-stat="refImagesCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipUnknownCategories") + '</dt><dd data-zip-stat="unknownCategoryCount">0</dd></div>' +
        '<div><dt>' + this.t("promptPresetZipIdenticalSkipped") + '</dt><dd data-zip-stat="exactDuplicateCount">0</dd></div></dl>' +
        '<p class="muted">' + this.t("promptPresetZipLocalOnlyHint") + '</p><div class="prompt-preset-zip-actions">' +
        '<button id="prompt-preset-zip-confirm" class="secondary-button" type="button">' + this.t("promptPresetZipImportAll") + '</button>' +
        '<button id="prompt-preset-zip-cancel" class="compact-button" type="button">' + this.t("cancel") + '</button></div></div></div>' +
        '</div></details>';
      this.search = this.container.querySelector("#prompt-preset-search"); this.category = this.container.querySelector("#prompt-preset-category");
      this.select = this.container.querySelector("#prompt-preset-select"); this.recent = this.container.querySelector("#prompt-preset-recent");
      this.favoriteButton = this.container.querySelector("#prompt-preset-favorite"); this.typeBadge = this.container.querySelector("#prompt-preset-type");
      this.addButton = this.container.querySelector("#prompt-preset-add"); this.displayName = this.container.querySelector("#prompt-preset-display-name");
      this.applyMode = this.container.querySelector("#prompt-preset-apply-mode"); this.removeButton = this.container.querySelector("#prompt-preset-remove");
      this.applyButton = this.container.querySelector("#prompt-preset-apply"); this.stackContainer = this.container.querySelector("#prompt-preset-stack");
      this.controls = this.container.querySelector("#prompt-preset-controls"); this.description = this.container.querySelector("#prompt-preset-description");
      this.usageHint = this.container.querySelector("#prompt-preset-usage-hint"); this.mainHint = this.container.querySelector("#prompt-preset-main-hint");
      this.message = this.container.querySelector("#prompt-preset-message");
      this.zipReview = this.container.querySelector("#prompt-preset-zip-review"); this.zipConfirm = this.container.querySelector("#prompt-preset-zip-confirm");
      this.handleSearchInput = debounce(() => this.refreshList(this.select.value), this.searchDebounceMs, this.timerApi);
      this.search.addEventListener("input", this.handleSearchInput);
      this.category.addEventListener("change", () => this.refreshList(this.select.value));
      this.select.addEventListener("change", () => this.selectLibraryPreset(this.select.value));
      this.favoriteButton.addEventListener("click", () => this.toggleFavorite()); this.addButton.addEventListener("click", () => this.addCurrentToStack());
      this.container.querySelector("#prompt-preset-rename").addEventListener("click", () => this.renameCurrent());
      this.container.querySelector("#prompt-preset-reset-name").addEventListener("click", () => this.resetCurrentName());
      this.container.querySelector("#prompt-preset-import").addEventListener("click", () => this.importJson());
      this.container.querySelector("#prompt-preset-import-zip").addEventListener("click", () => this.importZip());
      this.zipConfirm.addEventListener("click", () => this.confirmZipImport());
      this.container.querySelector("#prompt-preset-zip-cancel").addEventListener("click", () => this.closeZipReview());
      this.container.querySelector("#prompt-preset-export").addEventListener("click", () => this.exportCurrent());
      this.container.querySelector("#prompt-preset-export-all").addEventListener("click", () => this.exportAll());
      this.container.querySelector("#prompt-preset-restore-factory").addEventListener("click", () => this.restoreFactories());
      this.removeButton.addEventListener("click", () => this.removeCurrent()); this.applyButton.addEventListener("click", () => this.applyCurrent());
      this.refreshCategories(); this.refreshList(this.registry && this.registry.getRecentId ? this.registry.getRecentId() : ""); this.renderStack();
      if (root.PSAIImageHubCompat.enhanceSelects) root.PSAIImageHubCompat.enhanceSelects(this.container);
    }
    setMessage(key, isError, replacements) {
      this.message.hidden = !key; this.message.textContent = key ? this.t(key, replacements || {}) : "";
      this.message.className = "prompt-preset-message " + (isError ? "preset-error" : "muted");
    }
    showError(error) { this.setMessage(errorKey(error), true); }
    refreshCategories() {
      var previous = this.category && this.category.value || "all"; this.category.innerHTML = "";
      var separator = option("__preset-category-separator__", "────────"); separator.disabled = true;
      var options = [option("all", this.t("promptPresetAllCategories")),
        option(FAVORITES_CATEGORY_KEY, this.t("promptPresetFavoritesCategory")), separator];
      (this.registry ? this.registry.categories() : []).forEach((category) => options.push(option(category, categoryLabel(this.t, category))));
      replaceOptions(this.category, options);
      this.category.value = Array.prototype.some.call(this.category.options, function match(item) { return item.value === previous; }) ? previous : "all";
      if (root.PSAIImageHubCompat.refreshEnhancedSelect) root.PSAIImageHubCompat.refreshEnhancedSelect(this.category);
    }
    refreshRecent() {
      this.recent.innerHTML = ""; var items = this.registry && this.registry.recent ? this.registry.recent(8) : [];
      if (!items.length) return;
      var label = document.createElement("span"); label.className = "muted"; label.textContent = this.t("promptPresetRecent") + "："; this.recent.appendChild(label);
      items.forEach((preset) => {
        var button = document.createElement("button"); button.type = "button"; button.className = "preset-recent-button"; button.textContent = preset.displayTitle || preset.title;
        button.addEventListener("click", () => { this.select.value = preset.id; this.selectLibraryPreset(preset.id); }); this.recent.appendChild(button);
      });
    }
    refreshList(selectedId) {
      var preferred = selectedId || this.select && this.select.value || "";
      var category = this.category ? this.category.value : "all";
      var presets = this.registry ? this.registry.list({ search: this.search ? this.search.value : "", category: category }) : [];
      var emptyLabel = category === FAVORITES_CATEGORY_KEY && !presets.length ? this.t("promptPresetNoFavorites") : this.t("promptPresetNone");
      var options = [option("", emptyLabel)];
      presets.forEach((preset) => {
        options.push(option(preset.id, (preset.favorite ? "★ " : "") + categoryLabel(this.t, preset.category) + " · " + (preset.displayTitle || preset.title)));
      });
      replaceOptions(this.select, options);
      if (preferred && this.registry.get(preferred) && Array.prototype.some.call(this.select.options, function match(item) { return item.value === preferred; })) this.select.value = preferred;
      if (root.PSAIImageHubCompat.refreshEnhancedSelect) root.PSAIImageHubCompat.refreshEnhancedSelect(this.select);
      this.selectLibraryPreset(this.select.value); this.refreshRecent();
    }
    selectLibraryPreset(id) {
      this.currentLibraryPreset = id && this.registry ? this.registry.get(id) : null; var preset = this.currentLibraryPreset;
      this.addButton.disabled = !preset; this.removeButton.disabled = !preset; this.favoriteButton.disabled = !preset;
      var favoriteState = favoriteButtonState(this.t, Boolean(preset && preset.favorite));
      this.favoriteButton.textContent = favoriteState.label; this.favoriteButton.title = favoriteState.title;
      this.favoriteButton.setAttribute("aria-label", favoriteState.title); this.typeBadge.hidden = !preset;
      this.typeBadge.textContent = preset ? this.t("promptPresetType_" + preset.presetType) : ""; this.displayName.value = preset ? preset.localDisplayName || "" : "";
      this.description.hidden = !(preset && preset.description); this.description.textContent = preset && preset.description || "";
      this.usageHint.hidden = !(preset && preset.usageHint); this.usageHint.textContent = preset && preset.usageHint || "";
      if (preset && !this.selectedStackId) this.applyMode.value = preset.recommendedApplyMode || preset.applyModeDefault || "replace";
      this.refreshContext(); this.setMessage("");
    }
    saveCurrentValues() {
      if (!this.stack || !this.selectedStackId) return;
      try { this.stack.setValues(this.selectedStackId, this.readValues()); } catch (error) { /* Removed item. */ }
    }
    renderStack(selectedId) {
      if (!this.stackContainer) return;
      var items = this.stack ? this.stack.list() : []; this.stackContainer.innerHTML = "";
      if (!items.length) {
        var empty = document.createElement("div"); empty.className = "muted"; empty.textContent = this.t("promptPresetStackEmpty"); this.stackContainer.appendChild(empty);
        this.selectedStackId = ""; this.renderSelectedControls(); this.applyButton.disabled = true; return;
      }
      var preferred = selectedId || this.selectedStackId || items[0].presetId;
      items.forEach((item, index) => {
        var preset = this.registry.get(item.presetId); if (!preset) return;
        var row = document.createElement("div"); row.className = "prompt-preset-stack-row" + (item.presetId === preferred ? " selected" : "");
        var enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = item.enabled !== false; enabled.setAttribute("aria-label", this.t("promptPresetEnabled"));
        enabled.addEventListener("change", () => { this.stack.setEnabled(item.presetId, enabled.checked); this.renderStack(item.presetId); });
        var title = document.createElement("button"); title.type = "button"; title.className = "preset-stack-title"; title.textContent = preset.displayTitle || preset.title;
        title.addEventListener("click", () => this.selectStackPreset(item.presetId));
        var up = document.createElement("button"); up.type = "button"; up.className = "compact-button"; up.textContent = "↑"; up.disabled = index === 0;
        up.addEventListener("click", () => { this.saveCurrentValues(); this.stack.move(item.presetId, -1); this.renderStack(item.presetId); });
        var down = document.createElement("button"); down.type = "button"; down.className = "compact-button"; down.textContent = "↓"; down.disabled = index === items.length - 1;
        down.addEventListener("click", () => { this.saveCurrentValues(); this.stack.move(item.presetId, 1); this.renderStack(item.presetId); });
        var remove = document.createElement("button"); remove.type = "button"; remove.className = "compact-button"; remove.textContent = "×"; remove.setAttribute("aria-label", this.t("promptPresetRemoveFromStack"));
        remove.addEventListener("click", () => { this.saveCurrentValues(); this.stack.remove(item.presetId); this.renderStack(""); });
        row.appendChild(enabled); row.appendChild(title); row.appendChild(up); row.appendChild(down); row.appendChild(remove); this.stackContainer.appendChild(row);
      });
      this.selectedStackId = this.stack.get(preferred) ? preferred : items[0].presetId; this.renderSelectedControls();
      this.applyButton.disabled = !this.stack.enabledItems().length;
    }
    selectStackPreset(id) { this.saveCurrentValues(); this.selectedStackId = id; this.renderStack(id); }
    addCurrentToStack() {
      try {
        if (!this.currentLibraryPreset) throw new normalizer.PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
        if (!this.stack) throw new normalizer.PromptPresetError(CODES.UNSUPPORTED, "Preset Stack is unavailable.");
        this.saveCurrentValues();
        this.stack.add(this.currentLibraryPreset.id); this.selectedStackId = this.currentLibraryPreset.id;
        this.applyMode.value = this.currentLibraryPreset.recommendedApplyMode || this.currentLibraryPreset.applyModeDefault || "replace";
        this.renderStack(this.selectedStackId); this.setMessage("promptPresetAddedToStack", false);
      } catch (error) { this.showError(error); }
    }
    renderSelectedControls() {
      var item = this.stack && this.stack.get(this.selectedStackId), preset = item && this.registry.get(item.presetId);
      this.currentPreset = preset || null; this.currentValues = item && item.values || {}; this.controls.innerHTML = ""; this.controls.hidden = !preset;
      if (preset) this.renderControls(preset, this.currentValues); this.refreshContext();
    }
    renderControls(preset, savedValues) {
      var descriptors = [].concat(preset.controls || [], preset.fields || [], preset.toggles || []);
      descriptors.forEach((descriptor) => {
        var initial = savedValues && savedValues[descriptor.id] !== undefined ? savedValues[descriptor.id] : descriptor.default;
        if (descriptor.type === "hidden") { this.currentValues[descriptor.id] = initial; return; }
        if (descriptor.type === "note" || descriptor.type === "section") {
          var note = document.createElement(descriptor.type === "section" ? "strong" : "p"); note.className = "preset-note muted"; note.textContent = descriptor.label || descriptor.description; this.controls.appendChild(note); return;
        }
        var label = document.createElement("label"); label.className = descriptor.type === "toggle" ? "inline-check preset-control" : "preset-control";
        var title = document.createElement("span"); title.textContent = descriptor.label; title.className = "field-label"; var input;
        if (descriptor.type === "textarea") { input = document.createElement("textarea"); input.rows = 3; input.value = initial || ""; }
        else if (descriptor.type === "select") { input = document.createElement("select"); (descriptor.options || []).forEach(function add(item) { input.appendChild(option(item.value, item.label)); }); input.value = initial; }
        else {
          input = document.createElement("input"); input.type = descriptor.type === "slider" ? "range" : descriptor.type === "toggle" ? "checkbox" : "text";
          if (descriptor.type === "slider") { input.min = descriptor.min; input.max = descriptor.max; input.step = descriptor.step; input.value = initial; }
          else if (descriptor.type === "toggle") input.checked = initial !== false;
          else { input.value = initial || ""; input.placeholder = descriptor.placeholder || ""; }
        }
        input.setAttribute("data-preset-value", descriptor.id); if (descriptor.type !== "toggle") label.appendChild(title); label.appendChild(input); if (descriptor.type === "toggle") label.appendChild(title);
        if (descriptor.type === "slider") { var output = document.createElement("span"); output.className = "preset-slider-value"; output.textContent = input.value; input.addEventListener("input", function update() { output.textContent = input.value; }); label.appendChild(output); }
        input.addEventListener("change", () => this.saveCurrentValues());
        if (descriptor.description) { var help = document.createElement("small"); help.className = "muted"; help.textContent = descriptor.description; label.appendChild(help); }
        this.controls.appendChild(label);
      });
      if (!descriptors.some(function visible(item) { return item.type !== "hidden"; })) this.controls.hidden = true;
      if (root.PSAIImageHubCompat.enhanceSelects) root.PSAIImageHubCompat.enhanceSelects(this.controls);
    }
    readValues() {
      var values = Object.assign({}, this.currentValues);
      Array.prototype.forEach.call(this.controls.querySelectorAll("[data-preset-value]"), function read(input) {
        var id = input.getAttribute("data-preset-value"); values[id] = input.type === "checkbox" ? input.checked : input.type === "range" ? Number(input.value) : input.value;
      });
      return values;
    }
    refreshContext() {
      var preset = this.currentPreset || this.currentLibraryPreset;
      var suggestsMain = Boolean(preset && (preset.requiresMainImage || preset.recommendedMode === "image-to-image"));
      this.mainHint.hidden = !suggestsMain || this.hasMainImage(); this.mainHint.textContent = this.t("promptPresetMainImageHint");
    }
    importJson() {
      try {
        if (!this.cepFs || typeof this.cepFs.showOpenDialog !== "function" || typeof this.cepFs.readFile !== "function") throw new normalizer.PromptPresetError(CODES.UNSUPPORTED, "CEP JSON file picker is unavailable.");
        var picked = this.cepFs.showOpenDialog(false, false, this.t("promptPresetImportDialog"), "", ["json"]);
        if (!picked || picked.err !== 0 || !picked.data || !picked.data[0]) return;
        var path = picked.data[0], read = this.cepFs.readFile(path); if (!read || read.err !== 0) throw new normalizer.PromptPresetError(CODES.JSON_INVALID, "Preset file could not be read.");
        var parsed = packApi.parsePromptPresetImport(read.data, { fileName: fileName(path) });
        var result = this.registry.registerMany(parsed.presets, { conflict: "copy" });
        this.refreshCategories(); this.refreshList(result.added[0] && result.added[0].id || "");
        this.setMessage(parsed.isPack || parsed.count > 1 ? "promptPresetPackImported" : "promptPresetImported", false, { count: result.added.length });
      } catch (error) { this.showError(error); }
    }
    importZip() {
      try {
        if (!this.cepFs || typeof this.cepFs.showOpenDialog !== "function" || typeof this.cepFs.readFile !== "function" || !this.base64Encoding) {
          throw new normalizer.PromptPresetError(CODES.UNSUPPORTED, "CEP ZIP file picker is unavailable.");
        }
        var picked = this.cepFs.showOpenDialog(false, false, this.t("promptPresetZipImportDialog"), "", ["zip"]);
        if (!picked || picked.err !== 0 || !picked.data || !picked.data[0]) return;
        var path = picked.data[0], read = this.cepFs.readFile(path, this.base64Encoding);
        if (!read || read.err !== 0 || !read.data) throw new normalizer.PromptPresetError(CODES.ZIP_INVALID, "ZIP file could not be read.");
        var decoded;
        try { decoded = base64Api.base64ToBytes(read.data).bytes; }
        catch (decodeError) { throw new normalizer.PromptPresetError(CODES.ZIP_INVALID, "ZIP file could not be decoded."); }
        this.pendingZipScan = zipApi.scanPromptPresetZip(decoded, {
          existingPresets: this.registry && this.registry.presets || [], libraryLimit: 500
        });
        this.renderZipReview(this.pendingZipScan);
      } catch (error) { this.pendingZipScan = null; this.closeZipReview(); this.showError(error); }
    }
    renderZipReview(scan) {
      var stats = this.zipReview.querySelectorAll("[data-zip-stat]");
      Array.prototype.forEach.call(stats, function render(item) { item.textContent = String(scan[item.getAttribute("data-zip-stat")] || 0); });
      this.zipConfirm.disabled = !scan.importableCount; this.zipReview.hidden = false;
    }
    closeZipReview() { if (this.zipReview) this.zipReview.hidden = true; this.pendingZipScan = null; }
    confirmZipImport() {
      try {
        if (!this.pendingZipScan) throw new normalizer.PromptPresetError(CODES.NOT_FOUND, "ZIP scan result is unavailable.");
        var result = zipApi.importPromptPresetZipScan(this.pendingZipScan, this.registry);
        this.closeZipReview(); this.refreshCategories(); this.refreshList(result.added[0] && result.added[0].id || "");
        this.setMessage("promptPresetZipImported", false, { count: result.added.length, skipped: result.skipped, failed: result.failed.length });
      } catch (error) { this.closeZipReview(); this.showError(error); }
    }
    saveJson(text, suggestedName) {
      if (!this.cepFs || typeof this.cepFs.showSaveDialogEx !== "function" || typeof this.cepFs.writeFile !== "function") throw new normalizer.PromptPresetError(CODES.UNSUPPORTED, "CEP save dialog is unavailable.");
      var path = saveDialogPath(this.cepFs.showSaveDialogEx(this.t("promptPresetExportDialog"), "", ["json"], suggestedName)); if (!path) return false;
      var result = this.cepFs.writeFile(path, text); if (!result || result.err !== 0) throw new normalizer.PromptPresetError(CODES.UNSUPPORTED, "Preset file could not be written."); return true;
    }
    exportCurrent() {
      try {
        if (!this.currentLibraryPreset) throw new normalizer.PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
        if (this.saveJson(packApi.exportPromptPreset(this.currentLibraryPreset), packApi.safePromptPresetFileName(this.currentLibraryPreset.displayTitle, this.currentLibraryPreset.id))) this.setMessage("promptPresetExported", false);
      } catch (error) { this.showError(error); }
    }
    exportAll() {
      try { var presets = this.registry ? this.registry.list() : []; if (this.saveJson(packApi.exportPromptPresetPack(presets), "PS-AI-Image-Hub-Preset-Pack.json")) this.setMessage("promptPresetPackExported", false, { count: presets.length }); }
      catch (error) { this.showError(error); }
    }
    toggleFavorite() { try { if (!this.currentLibraryPreset) return; this.registry.toggleFavorite(this.currentLibraryPreset.id); this.refreshList(this.currentLibraryPreset.id); } catch (error) { this.showError(error); } }
    renameCurrent() { try { if (!this.currentLibraryPreset) return; var id = this.currentLibraryPreset.id; this.registry.rename(id, this.displayName.value); this.refreshList(id); this.renderStack(this.selectedStackId); this.setMessage("promptPresetRenamed", false); } catch (error) { this.showError(error); } }
    resetCurrentName() { try { if (!this.currentLibraryPreset) return; var id = this.currentLibraryPreset.id; this.registry.resetDisplayName(id); this.refreshList(id); this.renderStack(this.selectedStackId); this.setMessage("promptPresetNameRestored", false); } catch (error) { this.showError(error); } }
    restoreFactories() { try { this.registry.restoreAllFactories(); this.refreshCategories(); this.refreshList(""); this.setMessage("promptPresetFactoryRestored", false); } catch (error) { this.showError(error); } }
    removeCurrent() {
      try { if (!this.currentLibraryPreset) throw new normalizer.PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists."); var id = this.currentLibraryPreset.id; if (this.stack) this.stack.remove(id); this.registry.remove(id); this.refreshCategories(); this.refreshList(""); this.renderStack(""); this.setMessage("promptPresetRemoved", false); }
      catch (error) { this.showError(error); }
    }
    applyCurrent() {
      try {
        if (this.stack) {
          this.saveCurrentValues(); var compiledStack = compilerApi.compilePromptPresetStack(this.stack.list(), this.registry, this.compiler);
          var appliedStack = writePresetToPrompt(this.promptInput, compiledStack.text, this.applyMode.value);
          this.lastAppliedMetadata = { presetIds: compiledStack.presetIds.slice(), presetTitles: compiledStack.presetTitles.slice() };
          this.registry.recordApplied(compiledStack.presetIds); this.refreshRecent(); this.onApplied(this.lastAppliedMetadata);
          this.setMessage(appliedStack.duplicate ? "promptPresetDuplicateSkipped" : "promptPresetApplied", false); return;
        }
        if (!this.currentLibraryPreset || !this.registry.get(this.currentLibraryPreset.id)) throw new normalizer.PromptPresetError(CODES.NOT_FOUND, "Selected preset no longer exists.");
        var compiled = this.compiler.compile(this.currentLibraryPreset, this.readValues()); var applied = writePresetToPrompt(this.promptInput, compiled, this.applyMode.value);
        this.lastAppliedMetadata = { presetIds: [this.currentLibraryPreset.id], presetTitles: [this.currentLibraryPreset.displayTitle || this.currentLibraryPreset.title] };
        this.registry.recordApplied(this.lastAppliedMetadata.presetIds); this.onApplied(this.lastAppliedMetadata);
        this.setMessage(applied.duplicate ? "promptPresetDuplicateSkipped" : "promptPresetApplied", false);
      } catch (error) { this.showError(error); }
    }
    getLastAppliedMetadata() { return { presetIds: this.lastAppliedMetadata.presetIds.slice(), presetTitles: this.lastAppliedMetadata.presetTitles.slice() }; }
  }

  return { PromptPresetPanel: PromptPresetPanel, promptPresetErrorKey: errorKey,
    writePresetToPrompt: writePresetToPrompt, promptPresetFileName: fileName,
    promptPresetSaveDialogPath: saveDialogPath, promptPresetCategoryLabel: categoryLabel,
    promptPresetFavoriteButtonState: favoriteButtonState, createPromptPresetSearchDebounce: debounce,
    PROMPT_PRESET_FAVORITES_CATEGORY_KEY: FAVORITES_CATEGORY_KEY };
}));
