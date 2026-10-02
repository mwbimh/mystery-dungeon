# Mystery Dungeon / 迷宫

原生 JavaScript 回合制迷宫游戏，默认使用仓库自带的 Three.js；`?flat=1` 使用 2D。无需后端或运行时 npm 依赖。

## 设计师从这里开始

**数值权威源是 [`config/game.xlsx`](config/game.xlsx)，文本权威源是 [`config/texts.xlsx`](config/texts.xlsx)**，用 Excel 打开编辑，保存为 `.xlsx`。不要手写 `config/game.json`；它是可删除、可重新生成的构建输出，不进入 Git。详见[填表、校验、保存与恢复工作流](docs/excel-workflow.md)。

数据表：`Settings`（玩家/回合/地图/物品效果）、`Enemies`、`Items`、`EnemySpawns`、`ItemDrops`、`Themes`、`ThemeCatalog`，以及 `Documentation` 字段字典；独立文本工作簿提供 `Texts`。保留表名、表头和稳定 ID；支持增加已有敌人的出怪区间、调整权重及主题顺序。禁止公式、数字文本、空值和无效引用，转换器会报告工作簿、工作表及单元格位置。Excel 下拉/数值限制只辅助填写，转换器是最终校验依据。

```sh
# Python 3.12+；Node.js 22+（仅测试需要）
# 先安装 .NET SDK 8.0.408（或兼容 .NET 8 runtime）
python3 -m pip install -r requirements-dev.txt
python3 tools/install_luban.py  # 官方 Luban v5.1.0，下载并校验 SHA-256
python3 tools/convert_config.py
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/index.html` 正常游玩。不能直接双击 HTML：浏览器需要通过 HTTP 读取生成的 JSON。

修改 Excel 后保存，再次运行转换命令，并刷新浏览器。生成失败时**不会替换上次成功的 JSON**，此时页面仍可能读到旧配置，必须修正错误并看到 `Validated` 后才能验收新数据。

## 可重复试玩

打开 `http://127.0.0.1:8000/index.html?designer=1&seed=42&floor=4&debug=1&flat=1`。

- 自动进入指定楼层；`seed` 为 0–4294967295 整数，`floor` 为 1–通关层数。相同配置、URL、动作序列产生相同玩法结果；刷新从头开始。
- 去掉 `flat=1` 验证 3D；视觉粒子使用独立随机数，不承诺逐像素复现。
- 顶部显示试玩标识；仓库和技能记录仅在内存中，不读取或写入正式 `localStorage`，关闭/刷新丢弃试玩记录。
- `debug=1` 提供跳层和主题按钮；跳层仍沿用本次随机序列。比较数值时使用同一完整 URL 重载，不要仅在旧局上跳层。
- 试玩和正常模式都只加载本次 Excel 转换的配置，没有网页配置覆盖或第二条配置管线。

## 开发与验收

```sh
npm ci
npm run check          # 先经 Luban 从 Excel 生成；JS 语法、Node 回归、Python 转换测试
npm run build          # 再次转换并生成 dist/，不使用遗留 JSON
npx playwright install chromium
npm run test:browser   # Excel→JSON→实际游戏，隔离试玩及配置错误恢复
# 已安装系统 Chromium 可使用 CHROMIUM_PATH=/path/to/chromium
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

项目是无类型标注的原生 JS，无 TypeScript 编译步骤；`check:syntax` 为语法检查，不能等同于静态类型检查。Luban 的 XML 类型/引用 schema 位于 `config/Defines/tables.xml`；JSON 结构与项目玩法约束位于 `config/schema.json`。运行时配置在启动前按 `config/schema.json` 校验并冻结，非法或缺失数据阻断启动，不静默回退到另一套默认值。

GitHub Actions 在 `pull_request` 和 `push main` 时安装固定版本依赖、通过固定版本 Luban 重新转换 Excel、校验、测试、构建和浏览器验证，并上传静态站点产物。权限仅 `contents: read`，不用 `pull_request_target`，不需要写回 main 或部署凭据。本次没有部署或更改分支保护设置。

## 边界与兼容性

默认数值、素材、背包容量和技能槽逻辑保留；旧仓库与技能元数据的键和载荷不变。原游戏不保存完整地牢进度。基线与固定种子证据见 [docs/baseline.md](docs/baseline.md)，最终验收与剩余边界见 [docs/verification.md](docs/verification.md)。

本轮不把复杂材质、灯光、粒子结构强行放进表格；仍在 `js/themes.js`，表格只编排已有主题。新增敌人/物品行为、资源或主动技能类型需工程支持。表中的颜色用于现有 2D 标记，不替换 3D 美术。怪物屋填充算法、房间尺寸算法、UI 提示阈值等仍属于未开放的实现规则。

## 怪物与人物素材

素材沿用内部 ID → 文件名约定，见[素材命名与放置说明](docs/asset-naming.md)。显示名翻译不影响路径，不新增外观表。首次启动或构建前需 `git lfs install` 和 `git lfs pull --include="assets/runtime/**" --exclude=""`，确保获取真实图片；CI 已启用 LFS。

## 本地化与长期内容维护

`Enemies.nameKey`、`Items.nameKey` 和 `ThemeCatalog.nameKey` 引用 `Texts.key`；运行时默认 `zh-CN`，在 URL 加 `&lang=en` 使用英文内容名称。文本表必须填写 `zhCN`、`en`，所有语言的 `{name}` 占位符集合必须一致。缺译、断引用、重复 key 与错误占位符都会使生成失败。当前已接入敌人、物品、主题名称和试玩提示，原有整套 UI/帮助/叙事日志尚未全面本地化；没有外部翻译服务。

稳定 ID 与显示名称分离，改译文不改物品存档 ID。程序维护 Luban 类型/引用契约；后续新增内容表可复用该管线。新增行为仍需游戏实现，工具不会自动创造 AI 或技能逻辑。按领域拆分工作簿、翻译协作与格式迁移约定见[选型与实测记录](docs/luban-evaluation.md)。

## 配置工具选型

正式采用 **Luban v5.1.0** 作为唯一 Excel → 类型/引用校验 → JSON 主管线，适应长期内容增长和本地化。Python 只做公式与输入歧义预检、项目语义校验及游戏结构适配；无备用导出器。官方功能来源、真实敌人+文本表导出、断引用反例和 SHA-256 证据见 [docs/luban-evaluation.md](docs/luban-evaluation.md)。
