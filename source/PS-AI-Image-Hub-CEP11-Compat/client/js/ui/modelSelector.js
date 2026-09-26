(function defineModelSelector(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createModelSelector() {
  "use strict";

  class ModelSelector {
    constructor(container, options) {
      this.container = container;
      this.t = options.t;
      this.onChange = options.onChange || function noop() {};
      this.onCustomModel = options.onCustomModel || function passthrough(model) { return model; };
      this.models = [];
      this.selectedId = "";
      this.customFamilies = [];
      this.disabled = false;
    }

    mount() {
      this.container.className = "model-selector";
      this.container.innerHTML = `
        <button class="model-selector-trigger" type="button" role="combobox" aria-haspopup="listbox" aria-expanded="false">
          <span class="model-trigger-text">${this.t("selectModel")}</span><span aria-hidden="true">▾</span>
        </button>
        <div class="model-selector-menu" hidden>
          <div class="model-option-list" role="listbox"></div>
          <button class="custom-model-action" type="button">${this.t("customModelAction")}</button>
          <div class="custom-model-editor" hidden>
            <label>${this.t("customModelId")}<input class="custom-model-id" type="text" placeholder="new-model-2026" /></label>
            <label class="custom-family-field" hidden>${this.t("grsRequestFamily")}<select class="custom-model-family"></select></label>
            <div class="button-row"><button class="custom-model-cancel" type="button">${this.t("cancel")}</button><button class="custom-model-save secondary-button" type="button">${this.t("save")}</button></div>
            <div class="custom-model-error status-failed"></div>
          </div>
        </div>`;
      this.trigger = this.container.querySelector(".model-selector-trigger");
      this.triggerText = this.container.querySelector(".model-trigger-text");
      this.menu = this.container.querySelector(".model-selector-menu");
      this.optionList = this.container.querySelector(".model-option-list");
      this.customAction = this.container.querySelector(".custom-model-action");
      this.customEditor = this.container.querySelector(".custom-model-editor");
      this.customInput = this.container.querySelector(".custom-model-id");
      this.familyField = this.container.querySelector(".custom-family-field");
      this.familySelect = this.container.querySelector(".custom-model-family");
      this.error = this.container.querySelector(".custom-model-error");
      this.trigger.addEventListener("click", () => this.toggleMenu());
      this.trigger.addEventListener("keydown", (event) => this.handleTriggerKey(event));
      this.customAction.addEventListener("click", () => this.openCustomEditor());
      this.container.querySelector(".custom-model-cancel").addEventListener("click", () => this.closeCustomEditor());
      this.container.querySelector(".custom-model-save").addEventListener("click", () => this.saveCustomModel());
      this.customInput.addEventListener("keydown", (event) => { if (event.key === "Enter") this.saveCustomModel(); });
      document.addEventListener("click", (event) => { if (!this.container.contains(event.target)) this.closeMenu(); });
      this.render();
    }

    setModels(models, selectedId, options) {
      this.models = Array.isArray(models) ? models.slice() : [];
      this.customFamilies = options && Array.isArray(options.customFamilies) ? options.customFamilies.slice() : [];
      var requested = selectedId && this.models.some(function match(model) { return model.id === selectedId; }) ? selectedId : "";
      this.selectedId = requested || this.models[0] && this.models[0].id || "";
      this.render();
      if (!this.models.length) this.openCustomEditor();
    }

    render() {
      if (!this.optionList) return;
      this.optionList.innerHTML = "";
      this.models.forEach((model) => {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "model-option";
        button.setAttribute("role", "option");
        button.setAttribute("aria-selected", String(model.id === this.selectedId));
        var name = document.createElement("span"); name.className = "model-option-name"; name.textContent = model.displayName || model.id;
        button.appendChild(name);
        if ((model.displayName || model.id) !== model.id) {
          var id = document.createElement("span"); id.className = "model-option-id"; id.textContent = model.id; button.appendChild(id);
        }
        button.addEventListener("click", () => this.select(model.id));
        this.optionList.appendChild(button);
      });
      var selected = this.models.find((model) => model.id === this.selectedId);
      this.triggerText.textContent = selected ? selected.displayName || selected.id : this.t("customModelRequired");
    }

    select(modelId) {
      if (!this.models.some(function match(model) { return model.id === modelId; })) return;
      this.selectedId = modelId;
      this.render();
      this.closeMenu();
      this.onChange(modelId);
    }

    getValue() { return this.selectedId; }

    setDisabled(disabled) {
      this.disabled = disabled === true;
      this.trigger.disabled = this.disabled;
      if (this.disabled) this.closeMenu();
    }

    toggleMenu() { if (!this.disabled) this.menu.hidden ? this.openMenu() : this.closeMenu(); }
    openMenu() { this.menu.hidden = false; this.trigger.setAttribute("aria-expanded", "true"); }
    closeMenu() { this.menu.hidden = true; this.trigger.setAttribute("aria-expanded", "false"); this.closeCustomEditor(); }

    handleTriggerKey(event) {
      if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
        event.preventDefault(); this.openMenu();
        var first = this.optionList.querySelector(".model-option"); if (first) first.focus();
      } else if (event.key === "Escape") this.closeMenu();
    }

    openCustomEditor() {
      this.openMenu();
      this.customEditor.hidden = false;
      this.customAction.hidden = true;
      this.error.textContent = "";
      this.familySelect.innerHTML = "";
      this.customFamilies.forEach((family) => {
        var option = document.createElement("option"); option.value = family.id; option.textContent = family.displayName; this.familySelect.appendChild(option);
      });
      this.familyField.hidden = this.customFamilies.length === 0;
      this.customInput.focus();
    }

    closeCustomEditor() {
      if (!this.customEditor) return;
      this.customEditor.hidden = true;
      this.customAction.hidden = false;
      this.error.textContent = "";
    }

    saveCustomModel() {
      var id = String(this.customInput.value || "").trim();
      if (!id) { this.error.textContent = this.t("errorModelIdRequired"); return; }
      var model = { id: id, displayName: id };
      if (!this.familyField.hidden) model.family = this.familySelect.value;
      try {
        var saved = this.onCustomModel(model) || model;
        var index = this.models.findIndex(function match(item) { return item.id === saved.id; });
        if (index >= 0) this.models[index] = saved; else this.models.push(saved);
        this.customInput.value = "";
        this.selectedId = saved.id;
        this.render();
        this.closeMenu();
        this.onChange(saved.id);
      } catch (error) {
        this.error.textContent = error && error.message || this.t("errorInvalidProviderConfig");
      }
    }
  }

  return { ModelSelector: ModelSelector };
}));
