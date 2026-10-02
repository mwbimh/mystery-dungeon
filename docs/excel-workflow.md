# 设计师 Excel 工作流

六本 `.xlsx` 是游戏内容的唯一权威源。设计师编辑并保存源表；Luban 5.1.0 读取、校验类型/引用并导出中间表；转换器适配成版本 2 的 `config/game.json`，浏览器校验后使用。不要编辑生成 JSON，也不要把历史测试快照复制回来当生产配置。

## 先找到正确的表

| 工作簿 | 数据表 | 可以调整什么 |
| --- | --- | --- |
| `rules.xlsx` | `Settings` | 全局玩家生命/攻防/饱食、背包容量、栏位、饥饿与回血周期、预警、饱食成长、近战随机伤害 |
| 同上 | `RuleProfiles / RuleValues` | 多个完整规则组：怪物倍率/数量/刷新周期、闲逛、怪物房和全层物品/敌人数量 |
| `monsters.xlsx` | `Enemies` | 共享怪物目录：稳定 ID、文本引用、生命/攻防、后备颜色/字符、行为模板 |
| `items.xlsx` | `ItemEffects / Items` | 共享效果参数与物品目录；每种物品引用使用、投掷、挥杖效果 |
| `dungeons.xlsx` | `MapProfiles / MapValues` | 地图尺寸、网格、房间/大厅大小、跳过/合并/环路概率、怪物房概率 |
| 同上 | `Dungeons / FloorBands / ThemeCatalog` | 迷宫层数、默认组、楼层段、环境主题、每段权重组和可选覆盖 |
| `spawns.xlsx` | `EnemyGroups / EnemySpawns / ItemGroups / ItemSpawns` | 可被多个迷宫复用的怪物/物品相对权重组 |
| `texts.xlsx` | `Locales / TextKeys / Translations` | 语言、文本 key 与每个语言的译文 |

每本的 `Guide` 和 `Fields` 提供中文说明、字段类型/引用、单位、允许范围和示例。`Settings / RuleValues / MapValues` 还在数值旁保留说明列；这些注释以及 `TextKeys.context` 不进入运行配置。修改“范围说明”不能放宽实际限制。

## 日常修改、保存与恢复

1. 从 `design` 的最新版本开始，先阅读 `Guide`，确认修改哪一组规则、哪些迷宫会复用它。需要独立平衡时复制成新组，不直接改共享组
2. 数据从第 3 行开始。保留第 1 行字段名、A1 的 `##var`、A2 的 `##` 和第 2 行说明；数据行 A 列留空。不要改固定规则 `path`
3. 在原生数值格填写字面值；概率 `0.45` 表示 45%，权重不需要凑成 100。保存为 `.xlsx`，不要转 CSV
4. 运行转换和检查，修复所有错误。再刷新浏览器、从同一固定种子开新局，确认实际变化。旧局的生成地图、背包和临时状态不能代替新局验收
5. 提交相关工作簿、新 PNG、必要代码与试玩说明，走 `design → preview` PR。生成 JSON 不提交。合并后的具体 SHA 通过 CI 和私有预览后，才请求人工发布确认

Excel 下拉和数值限制只是辅助，粘贴可能绕过。最终以转换器、CI 和实际试玩为准。生成器不回写 Excel；保存前可使用 Excel 撤销。回退未提交改动前请先另存个人备份：

```sh
git restore -- config/rules.xlsx config/monsters.xlsx config/items.xlsx \
  config/dungeons.xlsx config/spawns.xlsx config/texts.xlsx
```

只想撤销某本时，仅保留那个路径。已提交内容通过 Git revert 和正常 PR 流程恢复，随后重新构建。二进制冲突必须保留双方版本，由负责人在最新表中重放需要的修改；不能用自动选一边或强推消除冲突。

## 全局规则、迷宫默认与楼层覆盖

生效顺序：

1. `Settings` 是全局参数，所有迷宫共用
2. `Dungeons.ruleProfileId / mapProfileId` 指向该迷宫默认的完整规则组和地图组
3. 当前 `FloorBands` 行的 `ruleProfileOverride / mapProfileOverride` 留空时继承迷宫默认；填写 ID 时替换为另一个**完整配置组**

规则组不是零散补丁，也没有“空值自动继承 classic”。新增 `RuleProfiles` 或 `MapProfiles` ID 时，必须复制对应 `Values` 中全部固定 path；每个 path 恰好一次，数值都必填。全局规则与选中的迷宫规则组一起构成本层规则。地图覆盖只换地图组，规则覆盖只换规则组，两者独立。

例如 `trainingGrove` 默认 `grove` 地图和 `gentle` 规则。`grove01` 覆盖 1–2 层，两项 override 为空；`grove03` 的地图仍继承 `grove`，但 `ruleProfileOverride=classic`，第 3 层整体使用 `classic` 的敌人/生成规则。

### 哪些数值值得先调

- 生存节奏：`Settings` 的 `player.hp`、`rules.hungerEvery`、`rules.regenEvery / regenAmount`、`rules.starvationDamage`。饥饿预警和危险阈值也可改
- 难度：`RuleValues.enemyScale` 缩放基础生命与攻击，结果取整且最低 1；防御仍来自怪物目录。`maxMonsters` 控制存活上限，`wandererEvery` 控制游荡怪补充周期
- 怪物密度：普通房间概率、怪物房预放/触发数量与面积除数、全层初始补足基数/递增层数/软上限。`maxMonsters` 仍约束总量
- 掉落密度：`floorItems`、`houseItems`、`houseTriggerItems` 的 min/max；“掉什么”在 `ItemSpawns`，“放多少”在规则组
- 地形：地图宽高 min/max、网格行列/阈值、最少房间、普通房间及大厅宽高、合并大厅/跳房概率、额外环路数量和概率。最小地图必须容得下网格与最小房间，大厅也有空间约束

所有 min ≤ max。怪物房上限不能超过存活怪物上限；初始栏位不能超过可解锁上限；饱食上限不能低于初始值。改变范围后要多种子试玩，结构合法不等于平衡合理或视觉良好。

## 按步骤新增一个迷宫

以下用 6 层 `mistPath` 举例，不需要改 JavaScript：

1. 在 `texts.xlsx / TextKeys` 新增 `dungeon.mistPath.name` 和用途说明；在 `Translations` 为每个已声明语言各新增一条译文
2. 在 `Dungeons` 新增 `mistPath`，`nameKey=dungeon.mistPath.name`，`totalFloors=6`，先复用 `classic` 地图和规则，`isDefault=0`。全表只能一行默认值为 1
3. 若需要新地形/难度，新增 `mistMap / mistRules`，复制原组全部参数，再修改需要的值；把 `Dungeons` 默认引用指向它们。只改显示名称不应改稳定 ID
4. 在 `spawns.xlsx` 复用已有组，或先在 `EnemyGroups / ItemGroups` 新增组 ID，再在对应 Spawns 表添加成员。每组至少一条成员，同组实体不重复，weight ≥ 0 且总和 > 0
5. 在 `FloorBands` 新增三行：`mist01` 为 1–2 层、`mist03` 为 3–4 层、`mist05` 为 5–6 层，`dungeonId` 都是 `mistPath`。每行选主题、怪物组、物品组，override 可先留空。主题只能选当前支持的 `cave / forest / wetcave / ruins / wooden / modern / cyber / future`
6. 保存并运行 `python3 tools/convert_config.py --check`，再运行 `npm run check` 和 `npm run build`
7. 普通模式在镇子确认新入口选项；用 `?designer=1&dungeon=mistPath&seed=42&floor=1&flat=1` 试玩。检查第 2→3、第 4→5 层的分段切换，以及第 6 层出口通关。另检查 3D 和目标语言

**每个迷宫的楼层段必须独立、连续、无重叠地覆盖 1 到 totalFloors，含首尾。** 不能遗漏第 1 层，不能只填“起始层后一直沿用”，不能越过总层数。行号不决定先后，编译按迷宫及起始层整理；相邻段可用相同主题，但仍需合法引用。缩短总层数时同步裁剪/删除超出的楼层段。

当前 `original` 有 24 层，保留原有每三层主题轮换及 1、2–3、4 层起的出怪变化；拆成多个段是为了同时表达主题和出怪边界。`trainingGrove` 有 3 层，是完整的新迷宫示例，不是只改名称的原迷宫别名。

## 新怪物 ID：复用已实现的追击模板

1. 在 `Enemies` 新增独立 ID，例如 `mossSlime`，填写基础生命/攻击/防御、名称 key、`#RRGGBB` 后备颜色和 1–2 字符 glyph，`behaviorTemplate=chase`
2. 为名称 key 补齐全部语言；放入真实 `assets/runtime/mossSlime.png`
3. 在需要的 `EnemySpawns` 组增加 `mossSlime` 及权重，并让相应楼层段引用该组
4. 转换、构建，检查实际生成、战斗和 2D/3D 图片

合法 ID 以英文字母开头，后接字母、数字或下划线，最长 64 字符；不能占用玩家/地形等渲染保留 ID，也不能与物品 ID 冲突。新增 ID 不再限制为旧 `slime / bat / shell` 三种，但只能选实现过的 `chase` 行为；填写一个新行为名字不会创建新 AI。现有 `emberSlime` 演示了新 ID、共享行为和独立基础数值。

## 新物品 ID：组合已有动作效果

`Items` 将三种动作分别指向 `ItemEffects`：`useEffectId`（使用/吃）、`throwEffectId`（投掷）、`swingEffectId`（挥杖）。没有该动作时填稳定 ID `none`，不是空格。`none` 效果必须存在且全部参数为 0。

| kind | 可用动作 | 有效参数 |
| --- | --- | --- |
| `food` | 使用 | `power` 恢复饱食，`range=0`；满腹成长由全局 bellyGrowth/bellyCap 决定 |
| `sleep` | 使用、投掷、挥杖 | `turnsMin / turnsMax`，至少 1 回合；使用影响玩家，命中动作影响目标 |
| `damage` | 使用、投掷、挥杖 | `power` 伤害强度；使用作用于玩家，远程动作作用于命中目标 |
| `knockback` | 投掷、挥杖 | `wallDamage` 撞墙伤害；不支持使用动作 |

使用效果 `range` 必须为 0；投掷/挥杖效果 `range` 必须为 1–200。非睡眠效果的回合数、非击退的撞墙伤害、非食物/伤害的 power 都填 0。未用参数不能暗中夹带另一效果。

新增例如 `trailFood`：复制食物记录，改 ID/nameKey；新增 `foodTrail` 效果，`kind=food / power=75`，其他参数 0；Items 的使用引用它，投掷可复用 `foodImpact`，挥杖填 `none`。补齐译文、`trailFood.png` 和掉落组即可。已有 `travelOnigiri` 就是恢复 75 饱食的变体。

- 有挥杖动作时 `chargesMin ≥ 1`、`chargesMax ≥ chargesMin`；没有挥杖动作两项填 0
- `activeSkill=1` 允许放入已有主动栏，且必须有投掷或挥杖动作；它不会生成一种全新主动技能
- 当前没有被动效果模板，`passiveSkill` 必须为 0；不要通过置 1 假装实现被动
- `dropOnMiss=1` 表示投掷落空后掉在地上，0 表示销毁；保持原物品的既有设定
- 旧 `sleepHerb` 使用 `herb.png`、`knockStaff` 使用 `staff.png`。这两个是兼容别名；新物品都按 ID.png，无须新外观表或文件名字段

## 新文本与新语言

`Locales` 定义语言 ID 与唯一默认语言；`TextKeys` 每个稳定 key 一行；`Translations` 每个 `(key, locale)` 一行。新增日语只需在 Locales 增加 `ja`，并为**所有 TextKeys**补齐 `ja` 翻译，不新增 `ja` 列，也不修改 schema。使用 `?lang=ja` 验证。每个 key 必须覆盖所有已声明语言；重复组合、缺译、未知语言都失败。

名称 key 不允许占位符。其他文本的 `{identifier}` 名称集合必须在所有语言中一致，不能省略、改名或留下不配对的大括号。例如 `preview.banner` 保留 `{seed}`、`{floor}`；`dungeon.current` 保留 `{name}`、`{floors}`。只翻译句子，不翻译参数名。`TextKeys.context` 是翻译语境，不能当译文。

当前提供 `zh-CN / en`，默认中文。新增迷宫选择、名称和物品动作文本已接入；旧界面、帮助和战斗叙事仍部分写在代码里。添加语言行不会自动翻译这些旧文本，也没有调用外部翻译服务。

## 格式约束与常见报错

- 整个工作簿，包括 Guide/Fields，都禁止公式与 Excel 错误值；需要计算时在个人草稿算好，粘贴为值。导出不采用公式缓存
- 数字必须为有限原生数值；整数不能是小数，不能用 `'30`、布尔、日期或数值字符串。文本无首尾空格，颜色是 `#RRGGBB`
- 数据表不允许合并格、额外列、伪装成 `##` 的隐藏数据行；不能新增/重命名工作表。可以增加合法内容记录，不能自行增加新字段/参数路径
- 只有两个楼层 override 引用可以留空；其他必填字段保持完整。完全空的数据行忽略，半空记录报错
- 缺图片、LFS 指针冒充 PNG、重复 ID、错误引用、未知模板、空/全零权重组、楼层缺口和重叠都会阻止构建
- 错误通常带 `config/rules.xlsx:Settings!C3` 这样的定位；缺失记录等整体约束可能指向表头或该表首条记录。先修第一处，再重新运行查看后续错误

## 本地命令与隔离实验

按 README 安装 Python 3.12、Node 22、.NET 8.0.408、固定依赖与通过 SHA-256 验证的官方 Luban 后，在仓库根目录运行：

```sh
python3 tools/convert_config.py --check  # 完整 Luban 校验，不写最终 JSON
python3 tools/convert_config.py          # 成功后原子替换 config/game.json
npm run check
npm run build
npx playwright install --with-deps chromium
npm run test:browser
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

隔离实验先把六本工作簿复制到独立目录，用 Excel 编辑副本：

```sh
mkdir -p /tmp/md-design-experiment
cp config/{rules,monsters,items,dungeons,spawns,texts}.xlsx /tmp/md-design-experiment/
python3 tools/convert_config.py --config-dir /tmp/md-design-experiment \
  --output /tmp/md-design-experiment/game.json
```

`--config-dir` 必须包含完整六本，仍使用仓库的类型契约、验证器与资源目录。只导出到临时目录不会自动让网页加载那份配置；网页固定读取所服务目录的 `config/game.json`。旧 `--workbook / --texts` 参数已不再使用。

`--dotnet` 或 `DOTNET_COMMAND` 指定 dotnet；`--luban` 或 `LUBAN_DLL` 指定已验证的 Luban.dll，默认 `.tools/luban/Luban/Luban.dll`。缺工具即失败，不换导出器。每次 Luban 在独立临时目录运行，只有退出码为 0 且全部校验通过才原子替换最终文件。失败保留上次成功产物，不能把它当作新配置验收通过。

相同工作簿重复转换生成同样的 UTF-8 JSON，不含时间戳。文本和楼层段做规范排序；权重成员顺序会影响固定种子选择的区间，比较实验时应保留顺序。输出上限 4 MiB，与浏览器一致。

## 存档和未开放内容

配置格式版本 2 与存储格式独立。`md-expedition-v1` 只记录选择的迷宫 ID；旧仓库 `md_warehouse_v1` 和技能元数据 `md-skill-meta` 保持原键/载荷。刷新不恢复整局冒险，试玩模式只使用内存存储。不要删除/复用已投入使用的实体 ID；已有仓库中的物品仍依赖它们。

死亡清空随身背包和装备、通关保留背包回镇、仓库保留等处理仍由原有代码控制，不是可填表的结算策略。迷宫选择只在镇子可用，没有新增中途逃离功能。房间留边、走廊/连通算法、复杂材质/灯光/粒子、全新 AI/技能，以及尚未实现的经验/商店系统不属于本轮表格能力。

发布与验收分别见 [release-pipeline.md](release-pipeline.md)、[sites-preview.md](sites-preview.md) 和 [verification.md](verification.md)。
