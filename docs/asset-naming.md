# 怪物与人物素材命名约定

使用稳定内部 ID 对应素材，不使用中文/英文显示名，也不新增外观配置表。当前映射已实现，无需修改渲染代码。

| 内部 ID | 基础素材 | 当前使用的附加素材 |
| --- | --- | --- |
| `slime` | `assets/runtime/slime.png` | `assets/runtime/slime-dirs.png`，现有八方向图集 |
| `bat` | `assets/runtime/bat.png` | `assets/runtime/bat-dirs.png`，现有八方向图集 |
| `shell` | `assets/runtime/shell.png` | 无；现有静态纸片精灵 |
| `player` | `assets/runtime/player.png` | `assets/runtime/player/{action}.png`，现有人物动作图集 |

人物 action 固定为 `idle`、`walk`、`run`、`attack`、`defend`、`climb`、`fail`。同一个内部 ID 可对应基础图和已有方向/动作文件；这里的“一对一”指一个 ID 确定一组既定素材，而非所有动作共用一个文件。

## 替换素材

1. 保持内部 ID、目录、大小写及上述文件名，替换对应 PNG。修改 `texts.xlsx` 的显示名不会改变素材路径；不要把文件改名为“史莱姆”或“Slime”。
2. 保持现有图像画布、切片布局、方向和动作排列。宽高、切片和动画规则仍由现有渲染代码决定，本次不将这些参数开放为表格配置。
3. `slime` / `bat` 的实际方向显示使用 `*-dirs.png`，只换基础 PNG 不会替换方向图集。`player` 同理，需要更新相应动作图集。
4. 执行 `npm run check` 和 `npm run build`，再在 3D 页面关闭浏览器缓存/强制刷新，确认朝向、遮挡和动作。2D 模式使用 Excel 中的 `color` / `glyph`，不是检查这些 PNG 的正确入口。
5. `slime_red.png`、`player_alt.png` 等未绑定的额外文件不会自动成为新怪物/人物。新增行为 ID 仍需程序注册和测试，不通过改显示名切换模型，也不支持任意模型路径。

资产为 Git LFS 文件。首次拉取后执行：

```sh
git lfs install
git lfs pull --include="assets/runtime/**" --exclude=""
```

CI checkout 已启用 `lfs: true`。运行时资源测试执行真实精灵加载器的路径选择，校验文件存在并具有 PNG 文件头；构建也会拒绝未展开的 LFS 指针，避免把指针文本当图片打包。校验不替代美术视觉验收。

本次未修改任何图片，也未改变既有素材映射、尺寸、图集或动画。城镇 NPC 贴纸仍属于原城镇 UI 资源，不是本次敌人/玩家映射的新增配置项。
