/* Shared item definitions and inventory helpers. Behavior comes from effect templates. */
(function (global) {
  const MD = global.MD;
  const ACTION_FIELDS = { use: "useEffectId", eat: "useEffectId", throw: "throwEffectId", swing: "swingEffectId" };
  const ITEM_DEFS = Object.create(null);

  function itemEffect(item, action) {
    const def = ITEM_DEFS[typeof item === "string" ? item : item && item.type];
    const field = ACTION_FIELDS[action];
    if (!def || !field || def[field] === "none") return null;
    return MD.config.itemEffects[def[field]] || null;
  }

  for (const [id, row] of Object.entries(MD.config.items)) {
    const definition = { ...row, id, name: MD.t(row.nameKey), verbs: [] };
    ITEM_DEFS[id] = definition;
    if (row.useEffectId !== "none") definition.verbs.push("eat");
    if (row.swingEffectId !== "none") definition.verbs.push("swing");
    if (row.throwEffectId !== "none") definition.verbs.push("throw");
    const use = itemEffect(id, "use");
    definition.eatLabel = MD.t(use && (use.kind === "food" || use.kind === "sleep") ? "item.eat" : "item.use");
    definition.throwLabel = MD.t("item.throw");
    definition.swingLabel = MD.t("item.swing");
  }

  function hasCharges(item) {
    return !!itemEffect(item, "swing");
  }

  function makeItem(type) {
    const def = ITEM_DEFS[type];
    if (!def) throw new Error("unknown item " + type);
    // Keep the legacy RNG order: identity first, then charges for charged items.
    const item = { type, name: def.name, uid: MD.random().toString(36).slice(2, 9) };
    if (hasCharges(item)) {
      item.charges = MD.randInt(def.chargesMin, def.chargesMax);
      item.name = displayName(item);
    }
    return item;
  }

  function displayName(item) {
    if (!item) return "";
    const name = ITEM_DEFS[item.type]?.name || item.name || "?";
    return hasCharges(item) ? name + " [" + (item.charges | 0) + "]" : name;
  }

  function itemColor(item) {
    return ITEM_DEFS[item.type]?.color || "#ccc";
  }

  function randomFloorItem(floorNum) {
    return makeItem(MD.weightedPick(MD.floorConfig(floorNum).itemEntries));
  }

  function saveWarehouse(list) {
    try {
      MD.storage.setItem("md_warehouse_v1", JSON.stringify(list));
    } catch (_) {}
  }

  function loadWarehouse() {
    try {
      const raw = MD.storage.getItem("md_warehouse_v1");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map((it) => {
        // Preserve stored IDs, charges and unknown legacy payloads. Refresh only
        // charged display names; uncharged names are resolved on display.
        if (it && hasCharges(it)) it.name = displayName(it);
        return it;
      });
    } catch (_) {
      return [];
    }
  }

  MD.ITEM_DEFS = ITEM_DEFS;
  MD.itemEffect = itemEffect;
  MD.itemHasCharges = hasCharges;
  MD.makeItem = makeItem;
  MD.displayName = displayName;
  MD.itemColor = itemColor;
  MD.randomFloorItem = randomFloorItem;
  MD.saveWarehouse = saveWarehouse;
  MD.loadWarehouse = loadWarehouse;
})(typeof window !== "undefined" ? window : globalThis);
