# 私人预览站发布

正式版使用 GitHub Pages，预览版使用独立、仅所有者可访问的 Sites。两者为不同 origin，普通游玩存储不会互相读写。版本 2 只在 `md-expedition-v1` 保存所选迷宫 ID，旧仓库/技能键不变；没有完整冒险存档。预览站的 `?designer=1&dungeon=original&seed=42&floor=4&debug=1&flat=1` 仍使用已有的内存试玩模式，不保存正式仓库或技能记录。

## 分支与验收

1. 策划在 `design` 编辑 `config/rules.xlsx`、`monsters.xlsx`、`items.xlsx`、`dungeons.xlsx`、`spawns.xlsx`、`texts.xlsx`，提交 **design → preview** PR。
2. PR 的 CI 安装固定版本工具，真实执行 Excel → Luban → JSON，校验、测试并构建产物。检查失败或存在合并冲突时保留上一次可用预览，不覆盖表格或继续部署。
3. PR 合并到 `preview` 后，针对合并后的**完整 Git SHA**重新构建，并更新下述同一个私人预览站。自动开发任务也只在 `preview` 集成已验证的改动，不绕过策划 PR。
4. 用户在站点验收该具体 SHA。记录 GitHub SHA、Sites 版本/部署 ID，以及明确验收的用户消息；新的 `preview` 提交不继承旧版本的验收。
5. 只有明确验收的候选版本才允许 **preview → main** PR 和合并。若 `preview` 或 `main` 已推进，先检查差异、重新测试，并在候选内容变化时重新验收。正式合并后由 Pages 工作流部署 `main`，参见 [发布流程](release-pipeline.md)。

`design` 不会自动重置为 `main` 或 `preview`。双边修改的 Excel 是二进制冲突，必须保留双方版本并请策划决定；禁止用 `ours`、`theirs` 或强推掩盖冲突。生成 JSON 是 CI/部署产物，不是策划权威源，不自动写回设计分支。

## 已注册预览站

- Site project ID：`appgprj_6abf37f379808191aece1448c4431460`
- 来源：`https://github.com/mwbimh/mystery-dungeon` 的 `preview`
- audience：仅所有者；不得因发布失败而自动改为公开
- 构建输出：静态 `dist/`

复用此 ID。GitHub 仓库与 Sites 自带的源码仓库是两个仓库；GitHub 的 `preview` SHA 与 Sites 的发布源码 SHA **不同**。站点的 `deployment.json` 记录 GitHub 来源 SHA、源码树、六本工作簿哈希和生成 JSON 哈希，Sites 版本 API 记录 Sites 源码 SHA。

## 可重复执行的发布步骤

### 1. 读取当前状态并打开同一个 Site

使用已授权的 GitHub 和 Sites 连接读取 `preview` 的最新 SHA、该 SHA 的 CI 结果、`get_site`、当前版本及部署状态。若源码未变化且对应部署已成功，直接复用，不重复发布。

使用 Sites 官方工具打开现有站点，保留返回的 checkout、source 结果与 project ID；已有 checkout 不可直接清空或覆盖。登录、授权和发布由官方受控工具处理，不要求设计师复制 token 或在 shell 中输入秘密，不把凭据写入文件、Git 配置、命令行、文档或日志。连接恢复后仍复用此 Site，不新建站点。Site 配置为：

```json
{"project_id":"appgprj_6abf37f379808191aece1448c4431460","static":{"directory":"dist"}}
```

读取打开后的 `dist/deployment.json`，记下 `source_sha` 作为本次期望的旧来源版本；首次发布填 `unpublished`。如果 Site 的源树比上次保存的结果更新，先检查并协调，禁止强推。

### 2. 获取并验证精确的 GitHub 修订

在另一个干净 checkout 获取 `preview` 并固定完整 SHA。先检查仓库说明和当前工具版本要求，安装 `.NET 8.0.408`、Python/Node 依赖以及通过 SHA-256 验证的官方 Luban 5.1.0，拉取真实 LFS 图片：

```sh
git lfs install --local
git lfs pull --include="assets/runtime/**" --exclude=""
python3 -m venv .venv
# 激活 venv，并将 dotnet 所在目录加入 PATH
python3 -m pip install -r requirements-dev.txt
python3 tools/install_luban.py
npm ci
```

运行适配脚本（替换绝对路径和实际 SHA）：

```sh
python3 tools/prepare_sites_preview.py \
  --source /absolute/github-checkout \
  --site-checkout /absolute/opened-site-checkout \
  --source-sha FULL_GITHUB_PREVIEW_SHA \
  --expected-previous-source-sha PREVIOUS_SHA_OR_unpublished
```

脚本只准备预览，不合并、不提交、不发布、不赋予验收。它核对远端 `preview`、本地干净状态、Site 身份和上一版本，运行 `npm run check`、`npm run build`，真实生成 JSON 并检查 PNG，成功后才更新 Site 的 `dist/`。失败时不得跳过校验、部署旧 JSON 冒充新配置。脚本输出的 `checks` 不包含浏览器测试；浏览器检查须另行运行或核对该完整 SHA 的 CI。

### 3. 保存并发布同一份经过验证的产物

在发布前重新读取 GitHub `preview`。若其 SHA 已改变，停止并重新选定候选，不发布过时内容后声称是最新版。若最后一次正式验收与当前 SHA 不同，状态仍为“待验收”。

在打开的 Site checkout 使用 Sites 官方发布工作流，将适配器准备的同一份 `dist/` 保存为版本。由官方工具负责授权、普通提交/推送、校验与打包，不重复生成另一份配置，不手动传递秘密，也不强推。执行者遵守工具当时返回的操作约定。

使用其返回的**Sites** `project_id`、`commit_sha`、`archive` 调用 `save_version_and_deploy_private`。若已经保存对应版本，复用版本 ID，不重复保存。对 pending/building/publishing 轮询 `get_deployment_status`；只有 `succeeded` 且返回 URL 才算上线。保留返回的 Sites version ID、deployment ID 与 GitHub SHA 映射。失败保留现有线上版本，报告原因；不能把 expected URL 或空注册站当成已上线。

通过原生 Sites 状态确认部署；用户实际游玩验收是独立步骤，不应把构建成功当成验收通过。多迷宫验收至少检查 original、trainingGrove、楼层覆盖/继承、新怪物与物品、镇子切换和试玩存储隔离；选择器不提供中途逃离。详细清单见 [verification.md](verification.md)。

## 自动化边界

GitHub Actions 负责 PR 校验、构建产物与 `main` 的 Pages 部署。当前仓库没有配置 GitHub push 直接触发 Sites 的 webhook，也不在 GitHub Secrets 存储个人 Sites 凭据；不能声称合并 `preview` 会由 GitHub 原生实时发布 Sites。

预览由已授权的开发任务使用以上连接与流程发布，包括每日任务发现新的已通过 CI 的 `preview` 提交时。任务运行前需确认该 Site 的所有权、访问级别、当前发布及已有计划，复用同一 Site。若需要“每次合并后立即发布”的额外触发器，应另行建立并验证，不能以网页轮询代替后台发布。

日常运行不得默认创建或继续 Codex Cloud Environment；只有用户明确选择该环境或当次批准后才可使用。遇到缺失连接、权限拒绝、版本冲突或人工验收缺失时，停止相关动作并报告，不切换身份或绕过门禁。
