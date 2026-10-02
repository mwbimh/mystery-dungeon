# 发布流程：正式版 GitHub Pages，预览版 Sites

## 分支与人工关卡

1. 日常开发和六本领域 Excel（`rules / monsters / items / dungeons / spawns / texts.xlsx`）调整提交到 `design`，**暂不开 PR**。`design` push 触发与 PR 相同的完整构建、156+ 项 Node / Python 回归及真实 Chromium 套件（连续运行两次）；先等具体 SHA 全部通过，再下载截图检查菜单、OP 桌面/手机与默认渲染效果。发现失败先在 design 修复和完整复测。
2. 只有上述分支 CI 与视觉检查完成后才开 `design → preview` 草稿 PR，在描述中记录已验证的精确 SHA、运行链接和覆盖范围；`Release route` 与 `Validate workbook and game` 必须通过。检查包含工作簿结构/值/引用、本地化、固定 SHA-256 的 Luban 5.1.0、生成 JSON、语法、资源、单元与 Chromium 测试（连续两遍，任一遍失败都阻止产物通过）。
3. 合并到 `preview` 后，同一提交再次构建并保存静态产物。通过已授权的 Sites 发布流程更新私有预览，核对实际部署 SHA，并执行试玩验收。
4. **只有人确认该预览提交可发布后**，才开 `preview → main` PR。PR 描述记录被验收的 SHA、私有预览入口、CI 运行链接及验收结果。预览有新提交时，旧确认不覆盖新内容。
5. 通过 PR 检查并获准合并后，按现有仓库规则 **Squash and merge** 到 `main`。合并触发全量检查、重建和 GitHub Pages 自动发布；自动化不能把 CI 通过当作人工确认。
6. 检查 Actions 的 `Deploy production Pages` 成功，再打开它给出的正式 URL，核对 `build-info.json` 的 `sourceCommit` 与 main 的新 squash 提交、检查静态资源并试玩。PR 使用 GitHub 的临时合并提交做测试，因此 PR 产物 SHA 可能不同于源分支 SHA；preview push 产物才是预览部署的准确依据。

不直接写 main，不自动合并正式版 PR，不从 `design`/`preview` 或 PR 事件部署 Pages。旧 `feature/designer-config → main` 草稿 PR 不由本次配置自动合并、关闭或重定向。

## CI 实现与产物

工作流：`.github/workflows/config.yml`（`Validate and release`）。

- 触发：目标为 `preview`/`main` 的 PR，以及`design` / `preview` / `main` 的 push。无需先开 PR 就可在 design 上完整验证；design 不会部署 Pages。PR 路径检查只接受同仓库的 `design → preview` 与 `preview → main`。
- 普通检查权限只有 `contents: read`，checkout 不保留凭据；构建 checkout 开启 Git LFS。
- Python 3.12、Node 22、.NET SDK 8.0.408；Python 依赖锁定版本、npm 使用锁文件。Luban 安装器锁定 5.1.0 并验证官方归档 SHA-256；缺工具或校验失败直接终止，不使用替代导出器。
- 产物 `mystery-dungeon-static-<sha>` 保留 14 天，只含 `dist/`。构建失败不上传成功产物，不部署。
- `dist/build-info.json` 记录实际 checkout SHA、分支、CI URL、生成配置及六本工作簿的 SHA-256（`workbooksSha256`）。URL 中无凭据。只有 `main` push 才打包 `github-pages` 产物。
- Pages job 依赖验证完成，并独占 `pages: write` / `id-token: write` 权限及 `github-pages` 环境；不创建 PAT、部署密钥或机器账号。部署采用官方 `configure-pages`、`upload-pages-artifact`、`deploy-pages` actions。
- PR/preview 的新构建取消同分支旧构建；main 发布不取消正在进行的运行，Pages 部署串行。

本地重现：按 [Excel 工作流](excel-workflow.md) 安装工具，再依次执行 `npm ci`、`npm run check`、`npm run build`、`npm run test:browser:stable`。菜单等待应依据 aria-busy 与真实 DOM/存储完成条件，OP 截图等待实际淡入完成，不得用固定 sleep、删断言或跳过用例掩盖竞态。CI 完成测试后才运行 `python tools/write_build_info.py`，避免浏览器测试重新构建时清除元数据。

## GitHub Pages 一次性配置与首次上线

仓库管理员在 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。不选从分支根目录发布，因为根目录不含本次工作簿生成的正式构建 JSON。2026-10-02，仓库所有者已确认该设置完成；实际 Pages 发布仍需首个 main 部署验证。

本次文件先进入 `preview`。当前旧 `main` 是无 Excel 构建的静态版本，**仅修改 Pages Source 不会部署这次功能**。不把新工作流单独复制到旧 main，也不为启动发布绕过人工验收。首次被验收的 `preview → main` 合并会同时带入构建工具和工作流，再自动执行首次正式部署。因此首次 merge 前，Pages 发布步骤处于“已准备、未端到端执行”。

若部署失败：查看该 main SHA 的 Actions 日志。确认 Source 仍为 GitHub Actions、`github-pages` 环境允许 main、仓库 Actions 策略允许这些官方 actions。修复之后重跑失败 job；不要上传旧配置冒充新构建，也不要放宽凭据/安全设置。若失败发生在构建阶段，修复仍走 design → preview → 人工确认 → main。

## 仓库保护（管理员核对，脚本不会修改设置）

截至 2026-10-02，现有 `primary` ruleset 已对默认分支启用：必须 PR、仅允许 squash、线性历史、禁止删除/强推、会话须解决、无 bypass actor。它当前没有 required status checks，required approving reviews 为 0；所以“必须 CI 成功”和“已人工验收”不能声称已由仓库设置完整强制。

新 CI 至少成功运行一次后，在 **Settings → Rules → Rulesets → primary** 中增加 required checks：

- `Release route`
- `Validate workbook and game`

不要把 `Deploy production Pages` 设为 PR 必须检查，它只在合并后运行。可为 `preview` 创建同样要求 PR 和上述 checks 的规则；保留禁止强推/删除。保护规则的增改由管理员明确授权后操作。

多人维护时可要求至少 1 位 reviewer 审核，并开启新提交撤销旧批准。单人仓库无法给自己创建的 PR 作有效审批，不应配置成永远无法合并；人工验收可以记录在 PR 描述/评论和实际合并决定中。自动化仍必须等待所有者对具体预览 SHA 的明确确认。

## Sites 预览的边界

GitHub Actions 已负责合并 preview 后的构建、校验和可追溯产物；**CI 通过不等于 Sites 已更新**。当前仓库没有可由公开 GitHub runner 调用的已授权 Sites CI 发布接口或凭据。不得臆造 endpoint、上传个人 token 或宣称已经全自动打通。

使用 [Sites 预览流程](sites-preview.md) 中已授权的 Sites connector/CLI，由受控助手从准确 preview SHA 构建/验证并更新原有私有 Site。发布后核对线上来源 SHA 与预览分支，而不是只报告提交成功。日常里程碑任务可以包含这一步，但它属于已授权发布流程，和 GitHub Actions 原生连续部署不同。使用官方受控发布工具处理登录与权限，不在文档、shell 命令、日志或 GitHub Secrets 中复制个人凭据。若将来接入官方 CI 发布能力，需另行明确授权其访问范围。

## Excel 与 Git LFS

`config/rules.xlsx`、`monsters.xlsx`、`items.xlsx`、`dungeons.xlsx`、`spawns.xlsx`、`texts.xlsx` 是普通 Git 二进制 blob。`.gitattributes` 仅为这六个精确路径排除 LFS，二进制合并继续禁用；旧 `config/game.xlsx` 已移除，其例外规则也移除。仅另为 `tests/fixtures/player-hp47-rules.xlsx` 这个隔离测试工作簿设置普通 Git blob；另对 `assets/runtime/opening/whale-maid.png`（3 MiB 原始立绘）使用精确路径普通 Git 例外；其他 Excel 和媒体保留原 LFS 规则。CI checkout 拉取 LFS，资源测试拒绝把 pointer 文本当 PNG。

六本是需要评审的源表，生成 JSON 不写回分支。发布工具从六本分别记录 SHA-256，版本 2 的 JSON 与浏览器都限 4 MiB；每次构建仍使用实际 Luban，无备用转换器。

## 回退

正式问题通过 PR revert 恢复至已知正确的代码和工作簿，再完整验证并合并 main；合并后 Pages 发布恢复版本。不要强推受保护分支，不手工编辑生成 JSON。若希望在 CI 恢复前紧急重部署某个旧产物，先取得对具体版本/目标的人工授权。

参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[发布源配置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)、[分支保护](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)。
