'use strict';

// Read-only route planning for a player-driven smoke journey. The caller must
// press the returned key through the real input path; this never edits a game.
const directions = [[0, -1, 'ArrowUp'], [1, 0, 'ArrowRight'], [0, 1, 'ArrowDown'], [-1, 0, 'ArrowLeft']];
function nextStepToItem(state, accepts) {
  const targets = new Set(state.items.filter(accepts).map(item => `${item.x},${item.y}`));
  const key = (x, y) => `${x},${y}`;
  const queue = [{ x: state.player.x, y: state.player.y, first: null }], seen = new Set([key(state.player.x, state.player.y)]);
  for (let index = 0; index < queue.length; index++) {
    const point = queue[index];
    if (targets.has(key(point.x, point.y))) return point.first;
    for (const [dx, dy, input] of directions) {
      const x = point.x + dx, y = point.y + dy, cell = key(x, y);
      // Deliberately do not cross stairs: entering one changes floors.
      if (state.map.tiles[y]?.[x] !== 1 || seen.has(cell)) continue;
      seen.add(cell); queue.push({ x, y, first: point.first || input });
    }
  }
  return null;
}
module.exports = { nextStepToItem };
