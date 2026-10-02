# Luban 选型与实测

本项目采用 **Luban 作为唯一 Excel 数据读取、类型和跨表引用校验、JSON 导出的主管线**。考虑的是未来敌人、物品、技能、关卡与本地化内容持续增长；当前表少及 .NET 依赖均不是排除 Luban 的理由。Python 只承担公式/歧义输入预检、项目特有语义校验及运行时结构适配，不保留备用的自研 Excel 导出路径。

## 官方能力与项目边界

- [官方 XML schema](https://www.datable.cn/docs/schema/xml-schema)：程序维护 schema，设计师在 Excel 填数据，避免误改类型约束。
- [官方校验](https://www.datable.cn/docs/quality/validators)：主键、引用、范围与集合校验。项目继续补充 min/max、起始楼层、权重、可支持的行为/素材 ID 等玩法约束。
- [官方本地化](https://www.datable.cn/docs/quality/l10n)：支持文本键、文本键校验、文本键列表与生成期转换；需显式配置 provider 才启用其文本校验。本项目采用显式 `string#ref=Texts` 跨表引用，保留 nameKey 并导出文本表，在浏览器按语言解析，不依赖未启用的隐式 text 校验。
- [官方发布](https://github.com/focus-creative-games/luban/releases/tag/v5.1.0)：固定 v5.1.0；[官方资产校验值](https://github.com/focus-creative-games/luban/releases/expanded_assets/v5.1.0)。安装器下载后先验 SHA-256，再解压到工具目录。

Luban 不替项目完成翻译、审核、多人合并或存档迁移。项目补充必需语言完整性、占位符一致性、Excel 公式拒绝与稳定 ID 约束。不调用任何外部翻译服务。

## 实际执行的最小验证（2026-10-02）

环境：Linux x86_64，.NET SDK 8.0.408，官方 Luban v5.1.0。

下载的 `Luban.7z` SHA-256：

```
bac9a1b8d69cfeaa7ef1d8c67b34a007324d1cd158e0b14294521b3879ba5213
```

建立真实敌人记录 `slime`、生命 6、`nameKey=enemy.slime.name`，以及中英文本表 `史莱姆 / Slime`。XML 将 nameKey 声明为 `string#ref=Texts`，hp 为 `int#range=[1,10000]`；执行 `-t client -d json --strict` 成功导出：

```json
[{"id":"slime","nameKey":"enemy.slime.name","hp":6}]
```

```json
[{"key":"enemy.slime.name","zhCN":"史莱姆","en":"Slime"}]
```

将此输出接到当前 `MD.makeEnemy`，得到 `{"name":"史莱姆","baseHp":6,"effectiveHp":5}`，保持原有 0.85 倍率与四舍五入。

将 Excel 名称 key 改为 `missing.key` 后返回 exit code 1，并报告 `Enemies["slime"].nameKey`、源 `Enemies@.../Game.xlsx` 和不存在的 `Texts` 引用。

**实测注意：Luban 的 `--strict` 可能在最终返回失败前已经写出 JSON。** 正式转换器在每次独立临时目录导出，检查退出码及项目校验全部成功后，才原子替换最终配置。因此非法输入不会发布部分或错误配置，也不会消费上次残留的 Luban 表输出。

## 长期内容约定

- 显示文案与稳定 ID 解耦；文本 key 和实体 ID 不随语言、排序或重命名变化。当前已发布的行为 ID 不允许删除或重用；新增行为/资源应与实现、迁移测试一起提交。
- 文本在独立 `texts.xlsx`，数值在 `game.xlsx`；按内容领域扩展时可在 Luban table input 中继续拆分工作簿，避免多人争用同一二进制文件。每本指定负责人；冲突先协调源表，不手工合并 `.xlsx` 二进制。
- 新增技能/关卡表使用 Luban bean/table、显式引用和范围约束；运行时适配器有意识地接入新结构。表格不能凭空创建尚未实现的技能行为。
- 新语言需同步扩展文本 schema、必填语言和运行时映射，并增加缺译/占位符测试。本轮提供 zh-CN/en 内容名称与试玩提示，不能宣称整个游戏 UI 已完成英文翻译。
- 配置版本当前为 1；未来改变运行时格式必须更新版本校验与兼容策略，不将 Excel 行号用作存档标识。
