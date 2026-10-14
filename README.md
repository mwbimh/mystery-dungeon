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

## 剧情（视觉小说）

- `js/story/vn.js`：播放器。`MD.story.trigger(event, ctx)` 按事件挑剧情播放；`MD.story.play(id)` 直接播放；`MD.story.validate()` 检查数据。
- `js/story/scenes.js`：角色和剧情数据，改台词只改这里。格式说明写在文件开头。
- 触发事件：`town`（进镇；`after: "death" | "clear"` 区分死亡/通关回镇）、`npc`（点镇上 NPC，`npc` 取按钮的 `data-npc`）、`floor`（到达某层）。
- 立绘放 `assets/runtime/portraits/<角色>.webp`；表情差分放 `assets/runtime/portraits/<角色>/<表情>.webp`，台词写 `["kimi:smile", "……"]` 即可，找不到差分时自动用默认立绘。也可以在角色的 `faces` 里给某个表情指定任意路径。
- 操作：点击 / Enter / 空格 / Z 推进，数字键或方向键选选项，Esc 跳过。播放时游戏输入被拦截。
- 已看过的剧情记在 localStorage `md_story_v1`。URL 加 `?nostory=1` 关闭剧情（自动测试用）。

## 存档

- `js/game/save.js`。全部存在浏览器 localStorage：`md_warehouse_v1`（仓库）、`md-skill-meta`（技能栏格数）、`md_story_v1`（看过的剧情）、`md_run_v1`（背包、技能栏、迷宫中途进度，约 17 KB）。
- 迷宫里每次行动后自动保存（防抖 250ms），关页面或切到后台时立即保存；重新打开会直接回到原来的楼层。
- 倒下时立刻作废进度、清空背包，刷新也不能反悔。
- 帮助面板里有「导出存档 / 导入存档」：导出是包含以上所有数据的 JSON 文件，导入校验后覆盖并刷新页面。
- 控制台：`MD.save.exportData()`、`MD.save.importData(obj)`。

## 自测

```sh
for f in js/*.js js/*/*.js; do node --check "$f"; done
```
