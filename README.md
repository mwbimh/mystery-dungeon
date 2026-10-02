# Mystery Dungeon / 迷宫

原生 JavaScript 回合制迷宫游戏。默认使用仓库自带的 Three.js，`?flat=1` 切换为 2D；无需后端或运行时 npm 依赖。

## 设计师从这里开始

**六本 Excel 是唯一内容权威源。** 用 Excel 打开、修改并保存为 `.xlsx`；固定版本 Luban 在构建时重新生成配置，浏览器不直接读取工作簿。

| 工作簿 | 主要内容 |
| --- | --- |
| [rules.xlsx](config/rules.xlsx) | 玩家、背包、饥饿、回血等全局规则；可共享的迷宫规则组 |
| [monsters.xlsx](config/monsters.xlsx) | 怪物 ID、名称引用、生命/攻防、已有行为模板 |
| [items.xlsx](config/items.xlsx) | 物品目录、使用/投掷/挥杖效果、次数和主动栏资格 |
| [dungeons.xlsx](config/dungeons.xlsx) | 迷宫目录、地图参数组、楼层段、主题及规则覆盖 |
| [spawns.xlsx](config/spawns.xlsx) | 可复用的怪物与物品权重组 |
| [texts.xlsx](config/texts.xlsx) | 语言目录、文本 key、逐 key/语言的译文 |

每本含 `Guide` 填写指南和 `Fields` 字段说明。数据表第 3 行起填数值和 ID；保留表名、表头与规则路径。禁止公式、数值文本和断引用，错误会尽量定位到工作簿、工作表和单元格。说明、单位、范围、示例是填写帮助，不是另一套运行参数。

完整步骤见[Excel 工作流](docs/excel-workflow.md)：包括新增迷宫、连续楼层覆盖、规则继承、新怪物/物品变体和新增语言。`config/game.json` 是可重新生成的输出，不手工修改、不进入 Git；旧 `game.xlsx` 已由六本领域表替代。

## 安装与启动

需要 Python 3.12、Node.js 22 和 .NET SDK 8.0.408（或兼容 .NET 8 runtime）。在仓库根目录执行：

```sh
git lfs install --local
git lfs pull --include="assets/runtime/**" --exclude=""
python3 -m pip install -r requirements-dev.txt
python3 tools/install_luban.py   # 官方 Luban 5.1.0，固定 SHA-256
npm ci
python3 tools/convert_config.py
python3 -m http.server 8000 --bind 127.0.0.1
```

打开 `http://127.0.0.1:8000/index.html`。需要通过 HTTP 读取 JSON，不能直接双击 HTML。每次修改 Excel 后先保存、重新转换，再刷新浏览器并开新局。

转换失败不会覆盖上次成功的 JSON；此时旧页面仍可能正常运行。必须看到新的 `Validated six domain workbooks`，再验收新数据。工具缺失、Luban 失败或配置非法都会中止，没有备用导出器或硬编码配置回退。

## 两个迷宫与可重复试玩

普通模式在镇子选择迷宫，点击“开始新冒险”或原有入口从第 1 层开始。冒险中不能切换；到所选迷宫最后一层出口才通关，回镇子后可重新选择。选择器没有增加中途逃离、撤退或保留背包的捷径。

- `original`：24 层，沿用旧版默认数值、主题顺序及原有怪物/掉落组
- `trainingGrove`：3 层的表驱动示例。前两层使用森林、`gentle` 规则；第 3 层改湿洞并整组覆盖为 `classic` 规则。使用 `emberSlime` 和 `travelOnigiri`，验证新 ID、共享模板、分组及继承，不代表新增 AI 或独立技能系统

固定种子试玩示例：

```text
http://127.0.0.1:8000/index.html?designer=1&dungeon=original&seed=42&floor=4&debug=1&flat=1
http://127.0.0.1:8000/index.html?designer=1&dungeon=trainingGrove&seed=42&floor=3&debug=1&flat=1&lang=en
```

`seed` 为 0–4294967295 的整数，`floor` 必须在所选迷宫范围内。相同配置、完整 URL 和动作序列可复现玩法；刷新从头开始。去掉 `flat=1` 检查 3D，视觉粒子不承诺逐像素一致。`debug=1` 提供跳层/主题按钮，跳层沿用本局随机序列；比较配置时请用同一 URL 重新加载。

普通模式从开始菜单选择新游戏、继续或读取存档。提供 **10 个独立存档位**，浏览器原生 IndexedDB 自动保存完整进度，每槽保留上一版恢复点；可下载 JSON 备份，或上传到指定存档位继续。仓库和技能栏随各槽隔离，新游戏不清空其他存档位。10 是界面容量选择，不是浏览器硬限制。清除网站数据、无痕模式或换设备可能丢失本地存档，建议定期下载。

设置包括启动片头、减少动态和下次启动的 2D/3D 模式；片头可点击或按 Esc / Enter / 空格跳过。旧版仓库与技能记录可从读档页面显式迁入空槽，旧键不删除；旧版没有保存地图或回合。配置不兼容、文件损坏、存储额度不足和多标签页冲突均会给出提示，不会静默覆盖。详见[存档与启动说明](docs/save-system.md)。

试玩仍有可见标识，仓库、技能元数据和迷宫选择只写内存，不读取或改写正式存档与设置。

## 开发、验收与发布

```sh
npm run check          # 真实 Excel → Luban → JSON，再执行语法与回归检查
npm run build          # 再次转换，生成独立静态 dist/
npx playwright install chromium
npm run test:browser   # 可用 CHROMIUM_PATH 指定已安装 Chromium
python3 -m http.server 8000 --bind 127.0.0.1 --directory dist
```

Luban 类型/跨表引用定义在 `config/Defines/tables.xml`；运行时结构和范围在 `config/schema.json`，项目语义约束由转换器与浏览器共享验证。配置版本为 2，生成与浏览器读取上限均为 4 MiB。启动前校验并冻结配置，失败时阻断游戏。项目没有 TypeScript 编译步骤，JS 语法检查不能等同于静态类型检查。

发布路径为 **design → preview PR → CI → 私有 Sites 预览 → 人工确认具体 SHA → preview → main PR → GitHub Pages**。CI 和本地检查都从六本 Excel 重新生成，不能拿旧 JSON 充当新构建。检查成功不等于预览已部署，也不等于人工验收。见[发布流程](docs/release-pipeline.md)、[私有预览](docs/sites-preview.md)及[验收清单与记录](docs/verification.md)。

## 内容扩展与明确边界

- 可新增合法怪物 ID，复用当前 `chase` 追击近战模板；可新增物品 ID，组合已支持的 `food`、`sleep`、`damage`、`knockback` 效果。新 AI、全新效果或被动技能仍需开发
- 图片按 `assets/runtime/<ID>.png` 放置；仅旧 `sleepHerb → herb.png`、`knockStaff → staff.png` 保留兼容别名。不增加外观映射表，显示名不决定路径。更详细的旧素材约定见[素材说明](docs/asset-naming.md)
- 地图尺寸、网格、房间/大厅范围、概率与刷怪/掉落数量已开放。房间留边、走廊绘制和连通算法仍在代码；主题材质、灯光和粒子也仍在代码
- 死亡丢弃随身背包及装备、通关带回物品、仓库保留沿用现有处理代码，未添加经验、升级、商店或战利品结算系统
- 文本表支持按行增加语言；默认中文，`?lang=en` 可检验英文。怪物/物品/主题名称、新迷宫界面及物品动作提示已接入，原有 UI 和叙事日志仍有中文，不能视为全游戏翻译完成

原始数值和固定种子地图由历史基线回归约束；合法设计改动应与默认基线分开验收，见 [baseline.md](docs/baseline.md)。[Luban 选型说明](docs/luban-evaluation.md)解释主管线、版本与长期维护约定。
