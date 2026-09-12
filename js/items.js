/* Items & inventory helpers */
(function (global) {
  const MD = global.MD;

  const ITEM_DEFS = {
    onigiri: {
      id: "onigiri",
      name: "饭团",
      color: "#e8d5a3",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    bigOnigiri: {
      id: "bigOnigiri",
      name: "大饭团",
      color: "#f5c16c",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    rock: {
      id: "rock",
      name: "石头",
      color: "#9aa4b2",
      verbs: ["throw"],
      throwLabel: "扔",
    },
    sleepHerb: {
      id: "sleepHerb",
      name: "睡眠草",
      color: "#a78bfa",
      verbs: ["eat", "throw"],
      eatLabel: "吃",
      throwLabel: "扔",
    },
    knockStaff: {
      id: "knockStaff",
      name: "击退之杖",
      color: "#5eead4",
      verbs: ["swing", "throw"],
      swingLabel: "挥",
      throwLabel: "扔",
    },
  };

  function makeItem(type) {
    const def = ITEM_DEFS[type];
    if (!def) throw new Error("unknown item " + type);
    const item = { type, name: def.name, uid: Math.random().toString(36).slice(2, 9) };
    if (type === "knockStaff") {
      item.charges = MD.randInt(4, 6);
      item.name = "击退之杖 [" + item.charges + "]";
    }
    return item;
  }

  function displayName(item) {
    if (!item) return "";
    if (item.type === "knockStaff") return "击退之杖 [" + (item.charges | 0) + "]";
    return ITEM_DEFS[item.type]?.name || item.name || "?";
  }

  function itemColor(item) {
    return ITEM_DEFS[item.type]?.color || "#ccc";
  }

  function randomFloorItem(floorNum) {
    const roll = Math.random();
    if (roll < 0.38) return makeItem("onigiri");
    if (roll < 0.52) return makeItem("bigOnigiri");
    if (roll < 0.78) return makeItem("rock");
    if (roll < 0.90) return makeItem("sleepHerb");
    return makeItem("knockStaff");
  }

  function saveWarehouse(list) {
    try {
      localStorage.setItem("md_warehouse_v1", JSON.stringify(list));
    } catch (_) {}
  }

  function loadWarehouse() {
    try {
      const raw = localStorage.getItem("md_warehouse_v1");
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map((it) => {
        // refresh display name for staff
        if (it && it.type === "knockStaff") {
          it.name = "击退之杖 [" + (it.charges | 0) + "]";
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
