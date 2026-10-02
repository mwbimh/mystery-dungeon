# Excel 配置工作流

`config/game.xlsx` 是数值/内容编排权威源，`config/texts.xlsx` 是本地化权威源。`config/Defines/tables.xml` 定义 Luban 类型/索引/跨表引用；`config/schema.json` 定义游戏适配结构与项目范围。`config/game.json` 是转换产物，不手工修改、不作为填表来源。页面实际读取生成的 JSON；每次构建均重新转换，失败即停止构建。

## 设计师填表

1. 用 Excel 打开 `config/game.xlsx` 和 `config/texts.xlsx`，先阅读 `Documentation`。保存为 `.xlsx`，不要转 CSV。表头、稳定路径和已有敌人/物品 ID 不改名。
2. 修改数值或文案。`Settings` 按 `player / rules / map / effects / themes` 分类，C 列是数值；悬停单元格批注可见中文说明、单位和范围，Documentation 有完整字段类型、范围和示例。概率按 0–1 填写，0.45 表示 45%；权重是相对比例，无需凑成 100。
3. 保存工作簿，然后校验、构建、启动本地服务器（命令见下）。Excel 的撤销只作用于尚可撤销的编辑；关闭前请保留需要的更改。生成器不回写 Excel。
4. 浏览器刷新后开新局核验属性和玩法。已有局可能保留此前数值；不要只观察旧存档就判定新配置未生效。变更截图/试玩步骤和两份 `.xlsx` 一起提交 PR，等待 CI。
5. 回退未提交改动前先另存个人备份，再运行 `git restore -- config/game.xlsx config/texts.xlsx`；已提交版本通过 Git 回退对应提交。重新构建并刷新。非法配置不会覆盖上次成功生成的 JSON，但构建会失败，不应把旧产物当成新配置通过。

| 表 | 填写方式 |
| --- | --- |
| Settings | 每个稳定 path 恰好一行；原生数值单元格。所有 min 必须小于等于 max；饱食上限不能低于玩家初始饱食度。 |
| Enemies | 固定 slime、bat、shell；可调名称引用 nameKey、颜色、HP、攻击、防御、字符。 |
| Items | 固定 onigiri、bigOnigiri、rock、sleepHerb、knockStaff；可调名称引用 nameKey 和颜色。效果数值在 Settings.effects。 |
| EnemySpawns | 同 fromFloor 的行必须连续；首组为 1，后续严格递增且不超过总楼层。每组 ID 不重复，weight 非负且合计大于 0。某楼层使用最后一个已达到 fromFloor 的分组。 |
| ItemDrops | 合法物品 ID 不重复；weight 非负且合计大于 0。可删行排除掉落，也可填 0。 |
| Themes | position 从 1 连续递增；id 从已支持主题选择。允许复用主题；超过顺序表长度沿用最后主题。 |
| ThemeCatalog | 已支持渲染器主题 ID → `theme.<id>.name`，nameKey 引用 Texts；新增渲染主题仍需开发支持。 |
| Texts（texts.xlsx） | key 是稳定文本 ID，可新增；zhCN 与 en 必填。敌人/物品通过 nameKey 引用。名称无占位符；其他文案两语言占位符集合一致。preview.banner 必須有且仅有 `{seed}`、`{floor}`。 |
| Documentation | 阅读说明和字段示例；不参与生成，但禁止公式及额外列。 |

Luban 数据表第 1 行 A 列为 `##var`，第 2 行 A 列为 `##` 说明标记；数据从第 3 行开始且 A 列必须留空。不得插入用 `##` 隐藏的数据行。

颜色为 `#RRGGBB`；字符串不能有首尾空格；数值不能填成文本（如前置英文单引号的 `'30`）、布尔值或日期。禁止任何公式，包括 Documentation 中公式；转换器读取公式文本并拒绝，不读取 Excel 缓存结果。需要计算时，请在另一个个人工作簿计算，再粘贴为值。整行全空可忽略，半空必填行会报错。不能新增/重命名工作表、增加表头外内容或合并单元格。Excel 内下拉框/范围校验只是辅助，粘贴可绕过，因此 CI 才是最终校验。

新敌人/新物品的行为、精灵动画、复杂地图算法仍由代码定义；不能通过增添 ID 行创建新行为。新增支持需开发同步 schema、资源和运行时逻辑。这避免把非表格资源强行塞进 Excel。

## 本地命令

先安装 .NET SDK 8.0.408（或兼容 .NET 8 runtime），在仓库根目录运行（Python 3.12、Node.js 22 为 CI 验证版本）：

```sh
python -m pip install -r requirements-dev.txt
python tools/install_luban.py
python tools/convert_config.py --check
python tools/convert_config.py
npm ci
npm run check
npm run build
npx playwright install --with-deps chromium
npm run test:browser
python -m http.server 8000
```

浏览器访问 `http://localhost:8000`。若只共享发布目录，则运行 `python -m http.server 8000 --directory dist`。不要通过 `file://` 打开，浏览器可能阻止读取 JSON。

隔离试验可用：

```sh
python tools/convert_config.py --workbook /tmp/experiment.xlsx --texts config/texts.xlsx --output /tmp/experiment.json
```

`--check` 仅校验不写最终文件，但仍执行完整 Luban 编译。`--dotnet` / `DOTNET_COMMAND` 可指定 dotnet 命令；`--luban` / `LUBAN_DLL` 可指定已验证的 Luban.dll 路径，默认 `.tools/luban/Luban/Luban.dll`。缺工具直接失败，绝无备用导出器。错误格式示例：`config/game.xlsx:Settings!C3: player.hp: value outside [1, 10000]`。缺表/缺行用预期表头位置定位；真实值错误定位到具体单元格。只有所有校验通过才原子替换输出文件，重复转换得到相同 UTF-8 JSON，无时间戳。Settings 和固定 ID 表行可重排；权重表、主题顺序保留填写顺序。

## 工程约定与验收

CI 使用同一组本地命令：PR 检查转换/测试/构建，main push（包含合并）从该次提交的工作簿重新生成配置后构建产物。无需写回 main 或机器凭据。工作簿二进制冲突不自动拼接：由单一编辑者在最新版本中重放双方改动，重新执行校验，并通过导出 JSON 对比确认修改内容。

常用验收：把 Settings 的 `player.hp` 改为 42，保存并转换，确认 JSON 的 `player.hp` 为 42；刷新游戏开新局确认血量，再恢复原表并重建。改变地图/生成/伤害规则还需多楼层试玩，校验成功不等于平衡或美术已验收。单元测试涵盖非法值、公式、引用、结构、权重、确定性和失败不覆盖；浏览器集成验证情况见本次交付记录。

## Luban 选型与扩展

采用官方 [Luban v5.1.0](https://github.com/focus-creative-games/luban/releases/tag/v5.1.0)；安装器验证固定 SHA-256 后提取。参考 [官方文档](https://www.datable.cn/docs/intro)。面向后续大量敌人/物品/技能/关卡和本地化，Luban 的 schema、跨表引用、类型与多目标生成比自建同等系统更合适。当前由 XML 定义类型和引用，Luban 是唯一 Excel→表 JSON 编译器；Python 预检只消除 Excel 歧义（例如公式/数值文本），后处理器将 Luban 输出适配现有浏览器结构并校验游戏特有约束，不维护第二套 Excel 导出管线。

编译使用 `--strict`，Luban 在返回失败前仍可能写出中间文件，因此每次都写独立临时目录；只有退出码 0 且项目校验全部通过才原子发布 game.json。默认中文兼容旧 name 字段，新增 nameKey 和 localization 文本数组支持运行时查表；使用 `?lang=en` 预览英文，`?lang=zh-CN` 为中文。文本 `{identifier}` 参数必须两语言一致，非法大括号拒绝，名称不接收参数。最终 JSON 限 256 KiB，与浏览器加载限制一致。

以后可把内容表按领域拆为独立 `.xlsx`，在 XML input 中指向新文件并更新预检清单；无需替换整个数据工具。新增技能/敌人行为仍需游戏侧行为协议与资源支持，然后扩展 XML、项目 schema、适配器和针对性测试。当前固定 ID 安全边界不代表 Luban 不能扩展。PR 评审需同时查看 schema/映射变更和生成 JSON 差异。英文文本为本次人工初稿，仍需设计/本地化审校。
