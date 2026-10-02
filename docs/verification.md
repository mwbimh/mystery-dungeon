# 本次验收记录

日期：2026-10-02。基线：`5ab2ad7f02ea773c9c25a68688f7ce3404060c05`；分支：`feature/designer-config`。只修改 mystery-dungeon，未推送、部署或合并。

## 已执行

| 检查 | 结果 |
| --- | --- |
| 改造前全部 `js/*.js` 的 `node --check` | 通过；原仓库没有构建/测试/静态类型检查任务 |
| `MD_TEST_BASELINE=1 node --test tests/baseline.test.cjs` | 10/10；固定原始提交通过 `git show` 加载 |
| `npm run check` | Excel 经实际 Luban 导出成功；所有游戏 JS 语法通过；65/65 Node 测试，26/26 Python 测试 |
| `npm run build` | 通过；重新转换后生成独立静态 `dist/` |
| `npm run test:browser` | 6/6；真实 Chromium，非 DOM mock |
| `git diff --check` | 通过 |

本地：Node.js 24.19.0、Python 3.12.14、openpyxl 3.1.5、py7zr 1.1.3、Playwright 1.58.2、Chromium 151.0.7922.173、固定官方 Luban v5.1.0。.NET SDK 8.0.408 在独立目录运行最终全量检查，确保与 CI pin 一致。CI 指定 Node.js 22；该 CI 配置尚未在 GitHub 执行，本地 Node 版本差异不记为 CI 已通过。

本环境命令（等价于 README 的 PATH 安装方式）：

```sh
DOTNET_COMMAND=/tmp/md-dotnet-pinned/dotnet PYTHONPATH=/tmp/md-py7zr npm run check
DOTNET_COMMAND=/tmp/md-dotnet-pinned/dotnet npm run build
DOTNET_COMMAND=/tmp/md-dotnet-pinned/dotnet npm run test:browser
```

### 覆盖内容

- 默认玩家/敌人、伤害、道具次数、掉落与出怪概率边界不变；五组历史地图 SHA-256 不变。
- 80 个极端地图样本检查边界、房间和楼梯可达；额外只读审查运行 3,200 个边界样本，未发现生成崩溃（后者不是新增固定测试集）。
- Excel 类型/范围/空值/公式/重复 ID/断引用/结构、权重/min-max/楼层、缺工具、缺译/占位符、生成体积、确定性及失败保留上次成功产物。
- 本地化文本 key、Unicode 字符长度、调用参数契约、中英实体名称和存档 ID 保留。
- 浏览器：正常镇子进入地牢；固定种子重载；实际回合推进；试玩存储与正式存储隔离；Excel `player.hp=47` 经 Luban 后实际玩家生命为 47；非法/缺失配置阻断、修复后重载恢复；独立 `dist/` 启动。
- Luban `--strict` 错误仍可能产生临时文件，测试确认这些文件不会发布到运行配置。

### 合法设计改动不会被旧基线拦截

另在隔离仓库副本中，把真实表的 `player.hp` 改成 47、`rules.totalFloors` 改成 1、删除超出楼层的生成组并反转 Texts 数据行顺序，再运行 `check`、`build` 和浏览器测试：全部通过（65 Node + 26 Python + 6 浏览器）。原工作簿已保持默认值，实验仅在临时目录。

历史数值来自 `tests/fixtures/default-config-v1.json`，只用于回归，不是另一份生产配置。真实 Excel 单独执行编译/结构校验和实际浏览器消费，合法平衡变化无需改写历史断言。

## 产物与 CI 消费链

`config/game.xlsx` + `config/texts.xlsx` → 固定 Luban / 临时表 JSON → 项目校验与适配 → `config/game.json` → `dist/config/game.json`。

最终源生成 JSON 与构建 JSON SHA-256 相同：

```
81d78546d53c18f2dfced49a6881b927e1e092216f9f7ae160b56c87251e9388
```

`dist/index.html` 引导 `js/config.js`，实际 fetch `config/game.json` 与 `config/schema.json`，校验成功后才启动游戏。无遗留硬编码默认配置回退。CI PR 和 main push 使用同一链路，并上传 `mystery-dungeon-static` artifact；没有写回 main 或部署步骤。

## 尚未验收与保留边界

- 未在桌面 Excel 或 LibreOffice 手工检验表格观感、撤销栈及多人协作；已通过 openpyxl 实际保存/重开和程序校验，提供了批注、数值范围、下拉及恢复步骤。
- 浏览器自动测试使用 2D；未进行 3D/WebGL 视觉验收、手机/控制器实机验收或长期平衡试玩。
- 正常城镇入口自动验收使用可见入口按钮聚焦后 Enter。鼠标中心点点击曾未进入，可能与原有悬停几何变化有关；未确认原因，也未改变原 UI。交付前应人工确认城镇鼠标入口。
- 当前本地化接入敌人、物品、主题名称及试玩提示；原有帮助、按钮、其他叙事文案没有全部迁移。英文为初稿，需审校。
- 现有敌人/道具行为 ID 保持固定；新增 AI、技能行为、资源、完整 UI 翻译和存档迁移仍需工程扩展。已建立可扩展的 Luban schema/引用/文本 key 管线，未声称任意新行为可仅靠表格实现。
- 无 TypeScript 配置；JS 语法检查不是静态类型检查。GitHub 托管 CI 未执行，不把本地成功冒充云端成功。

## 素材命名约定补充验收

用户选择内部 ID 对应素材，不新增 MonsterVisuals 或外观字段。核对现有 slime/bat/shell/player 映射后保留运行时不变，补充 `docs/asset-naming.md`。

新增资源测试发现初始环境中的 PNG 是尚未展开的 Git LFS 指针：上面的首次 2D/browser 和构建测试没有验证图片本体，不应据此认为素材完整。现已拉取并 checkout 原有 93 个 runtime LFS 对象（约 40 MB），没有修改图片内容；CI checkout 启用 LFS，构建新增 PNG 文件头检查，拒绝指针文件。

补充执行：`node --test tests/assets.test.cjs` 2/2；`python3 -m unittest discover -s tests -p 'test_asset_validation.py'` 2/2；实际素材构建通过；拉取真实素材后 `npm run test:browser` 6/6。新增测试运行原精灵加载器的路径逻辑，检查内部 ID、方向图、人物动作图路径及文件存在性；不把显示名当文件名。不新增尺寸、图集或动画配置，也未进行 3D 视觉验收。
