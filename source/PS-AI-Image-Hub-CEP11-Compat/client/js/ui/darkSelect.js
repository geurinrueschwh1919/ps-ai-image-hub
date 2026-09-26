(function defineDarkSelect(root, factory) {
  "use strict";
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PSAIImageHubCompat = root.PSAIImageHubCompat || {};
  Object.assign(root.PSAIImageHubCompat, api);
}(typeof globalThis !== "undefined" ? globalThis : this, function createDarkSelect() {
  "use strict";

  function refreshEnhancedSelect(select) {
    var control = select && select._psaiDarkSelect;
    if (!control) return;
    control.menu.innerHTML = "";
    Array.prototype.forEach.call(select.options, function addOption(option) {
      if (option.hidden) return;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "dark-select-option";
      button.textContent = option.textContent;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(option.value === select.value));
      button.disabled = option.disabled;
      button.addEventListener("click", function choose() {
        select.value = option.value;
        control.close();
        refreshEnhancedSelect(select);
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      control.menu.appendChild(button);
    });
    var selected = select.options[select.selectedIndex];
    control.button.textContent = selected ? selected.textContent : "—";
    control.button.disabled = select.disabled;
  }

  function enhanceSelect(select) {
    if (!select || select._psaiDarkSelect) return select && select._psaiDarkSelect;
    var wrapper = document.createElement("div");
    wrapper.className = "dark-select";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "dark-select-trigger";
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    var menu = document.createElement("div");
    menu.className = "dark-select-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(button);
    wrapper.appendChild(menu);
    select.classList.add("dark-select-source");
    var control = {
      button: button, menu: menu,
      close: function close() { menu.hidden = true; button.setAttribute("aria-expanded", "false"); },
      refresh: function refresh() { refreshEnhancedSelect(select); }
    };
    select._psaiDarkSelect = control;
    button.addEventListener("click", function toggle() {
      refreshEnhancedSelect(select);
      menu.hidden = !menu.hidden;
      button.setAttribute("aria-expanded", String(!menu.hidden));
    });
    button.addEventListener("keydown", function keyboard(event) {
      if (event.key === "Escape") control.close();
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        var active = menu.querySelector('[aria-selected="true"]') || menu.querySelector("button:not(:disabled)");
        if (active) active.focus();
      }
    });
    menu.addEventListener("keydown", function menuKeyboard(event) {
      if (event.key === "Escape") { control.close(); button.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        var options = Array.prototype.slice.call(menu.querySelectorAll("button:not(:disabled)"));
        var index = options.indexOf(document.activeElement);
        var next = event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index < 0 ? 0 : index - 1);
        if (options[next]) options[next].focus();
      }
    });
    document.addEventListener("click", function outside(event) { if (!wrapper.contains(event.target)) control.close(); });
    select.addEventListener("change", function changed() { refreshEnhancedSelect(select); });
    refreshEnhancedSelect(select);
    return control;
  }

  function enhanceSelects(container) {
    Array.prototype.forEach.call((container || document).querySelectorAll("select"), enhanceSelect);
  }

  return { enhanceSelect: enhanceSelect, enhanceSelects: enhanceSelects, refreshEnhancedSelect: refreshEnhancedSelect };
}));
