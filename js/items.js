/* Items & inventory helpers */
(function (global) {
  const MD = global.MD;

  const ITEM_DEFS = {
    onigiri: {
      id: "onigiri",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    bigOnigiri: {
      id: "bigOnigiri",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    rock: {
      id: "rock",
      verbs: ["throw"],
      throwLabel: "扔",
    },
    sleepHerb: {
      id: "sleepHerb",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    knockStaff: {
      id: "knockStaff",
      verbs: ["swing", "throw"],
      swingLabel: "挥",
      throwLabel: "扔",
    },
  };

  for (const [id, definition] of Object.entries(ITEM_DEFS)) {
    Object.assign(definition, MD.config.items[id]);
    definition.name = MD.t(definition.nameKey);
  }

  function makeItem(type) {
    const def = ITEM_DEFS[type];
    if (!def) throw new Error("unknown item " + type);
    const item = { type, name: def.name, uid: MD.random().toString(36).slice(2, 9) };
    if (type === "knockStaff") {
      item.charges = MD.randInt(MD.config.effects.staffCharges.min, MD.config.effects.staffCharges.max);
      item.name = ITEM_DEFS.knockStaff.name + " [" + item.charges + "]";
    }
    return item;
  }

  function displayName(item) {
    if (!item) return "";
    if (item.type === "knockStaff") return ITEM_DEFS.knockStaff.name + " [" + (item.charges | 0) + "]";
    return ITEM_DEFS[item.type]?.name || item.name || "?";
  }

  function itemColor(item) {
    return ITEM_DEFS[item.type]?.color || "#ccc";
  }

  function randomFloorItem(floorNum) {
    return makeItem(MD.weightedPick(MD.config.itemDrops));
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
        // refresh display name for staff
        if (it && it.type === "knockStaff") {
          it.name = ITEM_DEFS.knockStaff.name + " [" + (it.charges | 0) + "]";
        }
        return it;
      });
    } catch (_) {
      return [];
    }
  }

  MD.ITEM_DEFS = ITEM_DEFS;
  MD.makeItem = makeItem;
  MD.displayName = displayName;
  MD.itemColor = itemColor;
  MD.randomFloorItem = randomFloorItem;
  MD.saveWarehouse = saveWarehouse;
  MD.loadWarehouse = loadWarehouse;
})(typeof window !== "undefined" ? window : globalThis);
