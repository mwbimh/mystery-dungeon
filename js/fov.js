/* FOV: full room + doorways / corridor Chebyshev r=1 */
(function (global) {
  const MD = global.MD;

  function inBounds(map, x, y) {
    return x >= 0 && y >= 0 && x < map.width && y < map.height;
  }

  function computeVisible(map, px, py) {
    const visible = new Set();
    const rid = MD.getRoomId(map, px, py);
    if (rid != null && rid >= 0) {
      // Entire room
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.roomIds[y][x] === rid) visible.add(MD.key(x, y));
        }
      }

      // Room silhouette: bordering walls, plus doorway corridor tiles
      // so passages are visible from inside the room (classic MD).
      const doors = [];
      const roomKeys = [...visible];
      for (const k of roomKeys) {
        const [sx, sy] = k.split(",").map(Number);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const x = sx + dx, y = sy + dy;
            if (!inBounds(map, x, y)) continue;
            const nk = MD.key(x, y);
            if (visible.has(nk)) continue;
            const t = map.tiles[y][x];
            const nr = map.roomIds[y][x];
            if (t === MD.TILE.WALL) {
              visible.add(nk);
            } else if (nr === -1) {
              visible.add(nk);
              // Only treat orthogonal floor as a true doorway
              if ((dx === 0) !== (dy === 0)) doors.push({ x, y, dx, dy });
            }
          }
        }
      }

      // Peek one extra tile into each corridor so the passage reads as a hall, not a hole
      for (const d of doors) {
        const x2 = d.x + d.dx, y2 = d.y + d.dy;
        if (!inBounds(map, x2, y2)) continue;
        visible.add(MD.key(x2, y2));
      }
    } else {
      // Corridor: Chebyshev radius 1 (includes adjacent room tiles and walls)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = px + dx, y = py + dy;
          if (!inBounds(map, x, y)) continue;
          visible.add(MD.key(x, y));
        }
      }
    }
    return visible;
  }

  /** Same FOV rules from an arbitrary actor position (for AI LOS) */
  function canSee(map, ox, oy, tx, ty) {
    const vis = computeVisible(map, ox, oy);
    return vis.has(MD.key(tx, ty));
  }

  global.MD = MD;
  MD.computeVisible = computeVisible;
  MD.canSee = canSee;
})(typeof window !== "undefined" ? window : globalThis);
