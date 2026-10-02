# Luban 选型与长期维护

本项目采用 **Luban 5.1.0 作为唯一 Excel 类型/引用校验和表 JSON 导出的主管线**。六本源表分别维护规则、怪物、物品、迷宫、刷新组与文本，支持内容增长和多人按领域协作。Python 不充当备用 Excel 导出器。

## 当前实际链路

```text
rules.xlsx / monsters.xlsx / items.xlsx / dungeons.xlsx / spawns.xlsx / texts.xlsx
  → 输入预检（只检查类型歧义、公式、表结构及定位信息）
  → 固定官方 Luban：--strict，类型、索引、跨表引用，临时表 JSON
  → 项目结构适配和共享语义验证
  → 原子发布 config/game.json（version: 2，≤ 4 MiB）
  → 构建 dist/；浏览器重新验证、冻结配置后启动
```

运行配置的值来自 Luban 的导出，不来自预检器自行重读/拼接 Excel。说明列、`Guide / Fields` 和翻译语境帮助设计师填写，不进入玩法数据。构建不会从种子脚本或测试快照重建工作簿，设计师保存的 Excel 才是来源。

源表已经按领域拆分，不再把未来拆分当作尚未实施的扩展。当前示例包含：

- `original` 24 层，保留历史数值、出怪/掉落组和主题顺序
- `trainingGrove` 3 层，独立地图/规则/权重引用，最后一层演示整组规则覆盖
- 新 `emberSlime` 复用 `chase`，新 `travelOnigiri` 复用食物效果
- `Locales / TextKeys / Translations` 按行组织语言，新增完整语言无需增加固定语言列或修改 schema

这些是当前数据结构与内容实例；测试是否通过及未完成项以 [verification.md](verification.md) 的本轮记录为准。

## 为什么选 Luban

- [官方 XML schema](https://www.datable.cn/docs/schema/xml-schema) 支持由工程维护类型、索引和表间关系，设计师只填内容
- [官方校验能力](https://www.datable.cn/docs/quality/validators) 提供类型、主键和引用等通用约束；项目再补充楼层覆盖、模板组合、地图容纳、权重与翻译完整性等游戏语义
- [官方本地化能力](https://www.datable.cn/docs/quality/l10n) 可按项目选择接入方式。本项目使用显式 `string#ref=TextKeys`、`Translations.key → TextKeys` 和 `Translations.locale → Locales` 引用，在浏览器按语言取值；没有声称启用了未配置的隐式文本 provider
- [官方 v5.1.0 发布](https://github.com/focus-creative-games/luban/releases/tag/v5.1.0) 可固定版本，并以归档校验值验证来源

Luban 不会自动翻译、审核数值、解决 Excel 二进制冲突、创造新 AI 或迁移旧存档。工作簿说明、游戏语义校验、运行时接入和试玩仍是项目职责。

## 固定版本与失败行为

安装器 `tools/install_luban.py` 固定官方 `Luban.7z`，先验证以下 SHA-256 再解压：

```text
bac9a1b8d69cfeaa7ef1d8c67b34a007324d1cd158e0b14294521b3879ba5213
```

默认工具路径是 `.tools/luban/Luban/Luban.dll`。CI 使用 .NET SDK 8.0.408、Python 3.12、Node 22，依赖版本见锁文件。`npm run check` 和 `npm run build` 都实际执行转换；工具缺失、下载校验失败、Luban 非零退出或项目校验失败就停止，不能改用另一导出器或遗留 JSON。

早期真实 Luban 最小验证已发现：**`--strict` 返回失败之前仍可能写出中间文件**。因此正式管线每次使用独立临时目录，必须退出码为 0 且项目验证全部通过后才原子替换最终 JSON。错误不发布部分配置，也不消费上次残留的表输出；上次成功产物保留，但不能冒充本轮成功。

转换器和浏览器共用 `js/config.js` 的结构/语义验证。`config/schema.json` 的配置版本 2 只接受当前格式，不静默兼容 v1 JSON。预检补充浏览器不需要处理的 Excel 约束，包括任何工作表中的公式、数字文本、错误格、合并数据格和表结构变动。

## 内容与工程的分工

| 设计师可直接维护 | 需要工程支持 |
| --- | --- |
| 新迷宫、层数、连续楼层段、组引用与完整组覆盖 | 新生成算法、不同通关/死亡结算策略 |
| 新合法怪物 ID，复用 `chase`，调整数值及权重 | 新 AI 行为模板 |
| 新合法物品 ID，组合 food/sleep/damage/knockback | 全新效果、被动能力、全新技能体系 |
| 已支持主题编排、地图/房间范围及现有概率 | 新渲染主题、材质、灯光、粒子或动画系统 |
| 新文本 key、新语言行及全部译文 | 尚未迁出的旧 UI/日志文本接线 |

新 ID 的 PNG 遵守 `assets/runtime/<ID>.png`，仅保留旧 `sleepHerb → herb`、`knockStaff → staff` 别名。无需新增视觉映射表。所有新内容必须满足稳定 ID、图片和跨表引用要求；“支持任意合法 ID”不等于“支持任意行为”。

## 多人维护、版本与兼容

1. 每本源表指定编辑负责人，跨表新增内容在同一 PR 中交齐引用、译文和图片。冲突由人保留双方版本并重放修改，不自动拼接二进制
2. 稳定实体 ID 与显示名称分离；翻译、排序或改名不改变存档中的实体 ID。不要删除或复用已投入使用的 ID
3. 配置版本 2 与存储版本独立。新增 `md-expedition-v1` 只保存迷宫选择；旧仓库和技能元数据不变。没有完整冒险快照、断点续玩或新的存档迁移系统
4. 扩展契约时同步维护 `tools/config_contract.py`、生成的 XML/schema、转换器、运行时和测试；设计师不要自行加字段绕过契约
5. 评审既看源表变更，也对比重新生成的 JSON，并跑固定种子/行为回归。历史 v1/v2 测试快照仅供回归，不作为生产默认配置
6. 英文和新语言需人工审校。现有内容名称、新迷宫界面及物品动作可本地化，但旧 UI/日志仍部分中文，不能宣称全游戏已翻译

填写、隔离实验与错误定位见 [Excel 工作流](excel-workflow.md)，发布仍遵守 [人工验收流程](release-pipeline.md)。
