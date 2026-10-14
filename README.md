# 迷宫 · Mystery Dungeon

浏览器里的不可思议迷宫式 roguelike：镇子 + 24 层迷宫（每 3 层换一个主题），饱食度、怪物部屋，死亡丢背包、仓库保留。

纯 JS，**无构建步骤**。任意静态服务器打开 `index.html` 即可：

```sh
python3 -m http.server 8000
# http://localhost:8000/            3D 视图（Three.js）
# http://localhost:8000/?flat=1     2D 视图
# http://localhost:8000/?debug=1    调试面板（跳层、看主题）
```

图片资源用 Git LFS 管理，clone 后需要 `git lfs pull`。

## 代码结构

`index.html` 按顺序动态加载脚本（顺序有依赖，新增文件时要加进列表）：

| 文件 | 内容 |
| --- | --- |
| `js/themes.js` `map.js` `fov.js` `items.js` `actors.js` | 主题、地图生成、视野、道具定义、角色/敌人定义，挂在 `window.MD` 上 |
| `js/sprites.js` | 2D 贴图与玩家动画图集 |
| `js/view3d/*.js` | 3D 渲染器，共享状态挂在 `MD.v3d`，对外接口是 `MD.view3d` |
| `js/ui.js` | 2D 绘制、HUD 侧栏 |
| `js/game/*.js` | 游戏逻辑，共享上下文挂在 `MD.game` |

`js/view3d/`：`core`（常量、渲染器状态、噪声）→ `fx`（粒子）→ `theme`（主题与贴图）→ `paper`（纸片精灵、对象池）→ `terrain`（洞穴网格、楼梯、装饰）→ `visibility`（迷雾着色）→ `actors`（角色/物品公告板）→ `camera`（环绕相机）→ `main`（init / sync / render / 拾取）。

`js/game/`：`core`（常量、渲染模式、state、背包/技能栏工具、查询）→ `floor`（建层、进出迷宫、拾取、怪物部屋）→ `turn`（战斗、回合、饥饿、移动、冲刺、敌人 AI）→ `itemuse`（吃/扔/挥、瞄准、击退）→ `inventory`（背包与仓库 UI）→ `skillbar`（技能栏）→ `input`（键鼠与按钮）→ `main`（渲染循环、启动、调试面板）。

### 模块约定

每个文件是一个 IIFE。文件内部用普通函数；需要给其他文件用的，在文件末尾 `Object.assign(G, {...})` 导出。
后加载的文件在开头用 `const { a, b } = G;` 取先加载文件的导出；先加载的文件调用后加载文件的函数时写 `G.fn()`（运行时才取，避免加载顺序问题）。会被重新赋值的共享变量（如 `G.use3d`、`V.scene`）始终通过上下文对象读写。

### 缓存版本

`index.html` 里脚本的 `v` 和 CSS 链接的 `?v=` 保持一致，改动 JS/CSS 后一起加一。

## 自测

```sh
for f in js/*.js js/*/*.js; do node --check "$f"; done
```
