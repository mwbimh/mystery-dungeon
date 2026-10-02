# PaperDialogue 可迁移视觉小说组件

镇子点击 NPC 后打开对话；对话有角色立绘、姓名、身份、正文和分支选项。关闭后回到原来的 NPC。组件只负责呈现和选择，不读取 `MD`、存档、背包、地图或经济数据，也不启动迷宫。

## 文件边界

- `js/dialogue.js`：独立 IIFE，导出唯一全局 `PaperDialogue`
- `css/dialogue.css`：可独立复制的纸张 / 白边贴纸主题，全部使用 `pvn-` 前缀；无框架、第三方字体或图片依赖
- `js/town-content.js`：当前项目的六位角色、立绘路径和对话图，导出 `MDTownContent`。这是项目内容，迁移 UI 时不必复制
- `tests/dialogue.test.cjs`：不加载游戏、不依赖浏览器或第三方 DOM 库的组件契约测试

迁移到其他项目，只需复制前两个文件，在目标项目提供自己的场景数据和宿主回调。当前镇子的叙事文案与渲染分离；战斗数值和物品效果仍由原来的 Excel 配置管线负责，对话不覆盖它们。

## 最小接入

```html
<link rel="stylesheet" href="css/dialogue.css">
<script src="js/dialogue.js"></script>
<script src="js/town-content.js"></script>
```

```js
const dialogue = PaperDialogue.create({
  onOpen() {
    // 宿主清除按住的方向键、冲刺、延迟输入，并阻止自己的循环取动作。
    clearHostInput();
  },
  onClose() {
    clearHostInput();
  },
  onAction(event) {
    // 动作仅是意图。验证当前游戏状态、执行业务并打开自己的 UI。
    if (event.action === 'warehouse') openWarehouse();
  }
});

npcButton.addEventListener('click', () => {
  const scene = MDTownContent.get('ChatGPT');
  dialogue.open(scene, { trigger: npcButton, context: { npc: 'ChatGPT' } });
});

// 菜单、读档、离镇、结束本会话时，宿主显式关闭。
dialogue.close('navigation');
```

`open` 前先校验整张对话图。非法数据会抛出可诊断错误，且不会取代已经打开的有效对话。同一 document 内同时只显示一个 PaperDialogue；再次 `open` 或另一个控制器 `open` 会关闭上一场，并从新场景起点开始。

## API

`PaperDialogue.create(options)` 返回控制器，不立即创建 DOM。

| API | 作用 |
| --- | --- |
| `open(scene, {trigger, context}?)` | 挂载并打开场景，返回 `true`；trigger 为结束后恢复焦点的元素，默认当前焦点 |
| `close(reason?)` | 同步关闭、恢复背景和焦点；已关闭时返回 `false`，否则 `true` |
| `isOpen()` | 是否正在显示对话 |
| `getState()` | 返回 `{open, sceneId, nodeId}` 新对象，不暴露渲染内部状态 |
| `advance()` | 无选项时进入 `next`，或结束；存在选项时返回 `false` |
| `choose(indexOrId)` | 按 0 起始序号或选项 `id` 选择；非法选择返回 `false` |
| `destroy()` | 关闭并移除全部监听；已销毁控制器不可再次打开 |
| `PaperDialogue.validate(scene)` | 校验节点、选项和跳转；返回起点 ID |

创建选项：

- `document` / `mount`：可选；默认浏览器 document / document.body。定制 mount 必须在该 document.body 中。独立移植通常保持默认
- `labels`：覆盖 `close`、`next`、`finish`、`choose`、`hint`、`chapter`，用于本地化
- `reducedMotion`：禁用组件动画；同时自动遵循系统 `prefers-reduced-motion`
- `onOpen(state)` / `onNode(state)`：打开或渲染新节点的通知；初次 `onNode` 在 `onOpen` 前
- `onClose({reason, sceneId, nodeId, context})`：通知关闭。内置 reason 有 `dismissed`、`completed`、`action`、`replaced`、`destroyed`、`error`；宿主可传入自定义原因
- `onAction({action, payload, context, sceneId, nodeId, choiceId})`：玩家选择业务动作后的通知
- `onError(error)`：可选，接收宿主同步回调异常；未提供时写入 console。宿主自己的异步任务应自行处理失败

回调是通知接口，不由返回值控制跳转。为避免重入，回调不要在同一次通知内递归打开新场景。需要开启新业务面板时，使用 `onAction`。

## 场景格式

```js
const scene = {
  id: 'a-different-project',
  title: '旅人客栈 · 晚间',
  speaker: '店主',
  role: '客栈主人',
  portrait: 'art/innkeeper.png',
  start: 'greeting',
  nodes: {
    greeting: {
      text: '风把你带来了。想听一段故事吗？',
      choices: [
        { id: 'story', label: '讲讲这座镇子', next: 'story' },
        { id: 'leave', label: '下次再聊' }
      ]
    },
    story: { text: '很久以前，这里只有一盏灯。', next: 'ending' },
    ending: { text: '如今，灯光多了，故事也多了。' }
  }
};
```

- `start` 省略时使用第一个节点
- 节点必须有字符串 `text`；可用换行符。所有文案均通过 `textContent` 写入，不解析 HTML
- 节点可用 `speaker`、`role`、`portrait` 覆盖场景默认值；`portrait: null` 显示文字剪影
- `choices` 是可选数组。无 choices 时点击“继续”或按 Enter/空格，沿 `next` 跳转；无 next 则结束
- 选项必须有 `label`，建议提供稳定的 `id`。有 `next` 则跳转；有 `action` 则关闭并通知宿主；二者都没有则结束
- `action` 优先于 `next`。推荐每个选项只使用其中一个，避免含义不清
- `payload` 是可选的业务数据，组件不解释、不修改。`context` 由宿主在 `open` 时提供，不需要写入通用场景
- 场景由调用方拥有，打开期间应保持不变；`MDTownContent` 的导出内容已深冻结
- 图片为普通 URL / 相对路径，拒绝 `javascript:`、`vbscript:`、`data:` 和 `blob:`。立绘缺失会显示文字剪影，不影响推进和关闭

## 输入、焦点和宿主职责

组件以模态对话框呈现，使用独立的 `role="dialog"`、`aria-modal`、标题与正文关联。正文变更会以 polite live region 通知辅助技术。所有操作使用真实 button。

- Enter / 空格：推进正文，或选中当前聚焦选项；聚焦关闭按钮时关闭
- ↑↓ / ←→：在当前选项间循环；1–9 可直接选择对应选项
- Tab / Shift+Tab：在选项（或继续按钮）与关闭按钮之间循环
- Esc：退出；持续按住退出键不会穿透到游戏，直到对应 keyup 才释放拦截
- 可用鼠标和触屏操作；正文过长时卡片内部可滚动

对话期间，组件把背景兄弟元素设为 inert，并在关闭时恢复原值；自定义 mount 的祖先兄弟也会隔离。焦点离开组件会被带回，退出后恢复到 trigger。组件拦截普通键盘按下/释放及自己的指针冒泡事件，保留浏览器快捷键的默认行为。

宿主仍须在业务输入入口检查 `dialogue.isOpen()`，并在 `onOpen` / `onClose` 清空之前缓存的按键、延迟方向输入和冲刺状态。组件不能替宿主取消已经排队的回合、定时器、较早注册的 window capture 监听或全局游戏循环。宿主应在显示菜单、离开镇子、读档或重新开始时关闭对话。

`destroy` 会立即删除全部监听。如果在普通 `close` 时仍有按住的键，仅保留释放保护，收到 keyup 或窗口失焦后移除；不会残留 DOM。多个控制器共享“当前模态所有者”而不共享剧情进度。

## 仓库与未来服务扩展

当前内容仅发出已存在的 `warehouse` 动作。组件不存取物品，不修改存档，也没有加入金钱、商店交易或锻造玩法。

商店、锻造、任务板等未来功能可以独立面板实现，用同一宿主 action 分发器接收意图，无需扩展对话渲染器：

```js
// 未来项目的接口示例，不是当前游戏已实现的功能。
const handlers = new Map();
function registerAction(name, handler) { handlers.set(name, handler); }
const dialogue = PaperDialogue.create({
  onAction(event) {
    const handler = handlers.get(event.action);
    if (handler) handler(event);
  }
});
// 业务模块自行注册 shop / forge，并自行校验物品、费用及保存事务。
```

动作调用顺序固定为：销毁对话 DOM → 恢复 inert → 恢复焦点 → `onClose` → `onAction`。因此仓库面板不会叠在仍锁定焦点的对话框里。

## 验证

```sh
node --check js/dialogue.js
node --check js/town-content.js
node --test tests/dialogue.test.cjs
```

独立测试覆盖场景图校验、文本安全、分支和动作回调、按键推进/选择/自动重复/退出释放、焦点循环与恢复、背景 inert 恢复、重复打开、多控制器互斥、损坏立绘回退、销毁清理、全部镇子内容连通性与素材路径。实际游戏和屏幕布局由主浏览器回归覆盖；DOM 契约测试不等同于真实浏览器验收。
