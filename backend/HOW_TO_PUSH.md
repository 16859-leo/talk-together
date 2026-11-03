# 怎么上传到 GitHub

目标仓库：`https://github.com/jasper0507/talk-together.git`（远程已配好，无需再加）。

本次要提交的是新建的 `backend/` 目录，以及 `.gitignore`、`.gitattributes`、`README.md` 三处改动。

---

## 0. Git 身份（已配置完成）

本仓库已设置：

```
user.name  = silverbird-bit
user.email = 18211275785@163.com
```

无需再做。若要改，用 `git config user.name "..."` 重设；加 `--global` 则对所有仓库生效。

---

## 0.2 本机网络的 SSL 问题（已处理，但要知道）

你这台机器访问 GitHub 时，Windows 无法连到证书吊销列表（CRL）服务器，
会报这个错：

```
fatal: unable to access 'https://github.com/...':
schannel: next InitializeSecurityContext failed: CRYPT_E_NO_REVOCATION_CHECK (0x80092012)
```

这是校园网/企业网常见限制，**不是你的配置错**。实测 `http.schannelCheckRevoke=false`
在你这里不稳定，可靠的办法是推送时临时加一个环境变量：

PowerShell：

```powershell
$env:GIT_SSL_NO_VERIFY="true"
git push -u origin feat/backend-v0.1.0
Remove-Item Env:\GIT_SSL_NO_VERIFY     # 用完就清掉
```

Git Bash：

```bash
GIT_SSL_NO_VERIFY=true git push -u origin feat/backend-v0.1.0
```

> 它只对这一条命令生效，用完即失效。
> 注意这会跳过证书校验，**只在你信任当前网络时使用**，不要写进全局配置。
> 换到正常网络（如手机热点）就不需要它。

---

## 0.5 当前状态：等协作者权限（已实测）

已用你的账号实际推送过一次，结果：

```
remote: Permission to jasper0507/talk-together.git denied to silverbird-bit.
fatal: ... The requested URL returned error: 403
```

确认 `silverbird-bit` 目前**不是** `jasper0507/talk-together` 的协作者，推不上去。

GitHub 没有「直接推到别人仓库、然后等审核」这种机制。
PR 本身就是审核流程，但前提是分支得先推到你有写权限的地方。所以只有两条路：

| 路线 | 前提 | 说明 |
| --- | --- | --- |
| **要协作者权限**（当前选择） | jasper0507 把你加进来 | 分支直接推原仓库，提交历史最清晰 |
| Fork | 不需要任何权限 | 先推到自己的副本，再跨仓库发 PR |

### 怎么要权限

把这段发给 jasper0507：

> 麻烦把 GitHub 账号 `silverbird-bit` 加进 talk-together 的协作者：
> 仓库 → Settings → Collaborators → Add people → 输入 `silverbird-bit` → Add。
> 后端 v0.1.0 已经写完，等权限推分支发 PR。

你会收到一封邀请邮件（或在 `https://github.com/jasper0507/talk-together/invitations` 查看），
**点击 Accept 之后**才生效。

---

## 1. 本地提交（已完成）

分支和提交我已经替你做好了：

```
分支：feat/backend-v0.1.0
提交：a78574b  feat(backend): implement rooms, chat and AI orchestration
内容：28 个文件
```

确认一下：

```bash
cd D:\作业\实践周\talk-together
git log --oneline -2
git status
```

`git status` 应显示 `nothing to commit, working tree clean`。

**不需要**再执行 `git add` 或 `git commit`，直接跳到第 2 步推送。

---

## 2. 拿到权限后：推送

接受邀请后，在项目目录执行：

```powershell
cd D:\作业\实践周\talk-together
$env:GIT_SSL_NO_VERIFY="true"
git push -u origin feat/backend-v0.1.0
Remove-Item Env:\GIT_SSL_NO_VERIFY
```

Git Bash 写法：

```bash
GIT_SSL_NO_VERIFY=true git push -u origin feat/backend-v0.1.0
```

**不会再要你登录**——凭证助手里已经有 `silverbird-bit` 的有效登录态，实测可用。
之前失败纯粹是权限问题，不是登录问题。

成功的输出大致是：

```
Enumerating objects: 40, done.
...
To https://github.com/jasper0507/talk-together.git
 * [new branch]      feat/backend-v0.1.0 -> feat/backend-v0.1.0
```

---

## 3. 创建 Pull Request

推送成功后，终端会直接给出一个链接，形如：

```
remote: Create a pull request for 'feat/backend-v0.1.0' on GitHub by visiting:
remote:      https://github.com/jasper0507/talk-together/pull/new/feat/backend-v0.1.0
```

**复制这个链接到浏览器打开**，就是 PR 创建页。

填写要点：

- **标题**：`feat(backend): 按 v0.1.0 契约实现后端`
- **base 分支**：`main`；**compare 分支**：`feat/backend-v0.1.0`
- **描述**：建议写清楚三件事，正文可直接用下面这段

```markdown
## 内容

按 v0.1.0 契约实现 backend/，覆盖 11 个 HTTP 操作与 17 类 WebSocket 事件。
详见 backend/IMPLEMENTATION_PLAN.md。

## 验证

- `npm run check --prefix contracts` 通过，契约未改动
- `npm run typecheck` 通过
- `npm test` 58 / 58 通过
- `npm run demo` 端到端演练 28 步全部达成

## 需要 3 号确认

能力插件接口已定案，见 IMPLEMENTATION_PLAN.md 第 3 节。
与原提议有两处调整：signal 并入 context；invite chunk 不接收，
邀答目标由应用层选定后经 context.invitedMember 下发。
```

找不到链接也没关系：打开仓库页面，顶部会出现
「`feat/backend-v0.1.0` had recent pushes」的黄色提示条，
点右边的 **Compare & pull request** 按钮即可。

---

## 4. 备选：如果一直拿不到权限，用 Fork

jasper0507 短期内加不了你的话，Fork 路线不需要任何权限，提交已经在本地，不用重做。

**第一步**：浏览器打开 `https://github.com/jasper0507/talk-together`，点右上角 **Fork**。
得到 `https://github.com/silverbird-bit/talk-together`。

**第二步**：加一个指向自己 Fork 的远程（原 `origin` 保持不动）。

```powershell
cd D:\作业\实践周\talk-together
git remote add mine https://github.com/silverbird-bit/talk-together.git
$env:GIT_SSL_NO_VERIFY="true"
git push -u mine feat/backend-v0.1.0
Remove-Item Env:\GIT_SSL_NO_VERIFY
```

**第三步**：推完给出的链接即是 PR 创建页，
base 选 `jasper0507/talk-together` 的 `main`，compare 选你 Fork 的分支。

效果和路线一样，jasper0507 一样能 review 和合并，只是提交会显示来自 Fork。

---

## 常见问题

**`! [rejected] ... (fetch first)`**
远程有别人的新提交。先同步再推：

```powershell
$env:GIT_SSL_NO_VERIFY="true"
git pull --rebase origin main
git push -u origin feat/backend-v0.1.0
```

rebase 出现冲突时，解决冲突后执行 `git add <文件>` 和 `git rebase --continue`。

**推送卡住不动，没有任何提示**
凭证助手没弹窗。先确认配置在：

```bash
git config --global credential.helper
```

应输出 `manager`。若为空则执行 `git config --global credential.helper manager`。

**想撤销这次提交重做**

```bash
git reset --soft HEAD~1      # 撤销提交，文件改动保留在暂存区
git reset                     # 进一步清空暂存区
```

**PR 创建后还要改东西**
在同一分支继续提交并推送即可，PR 会自动更新，不用重新创建：

```powershell
git add <改动的文件>
git commit -m "fix: ..."
$env:GIT_SSL_NO_VERIFY="true"; git push; Remove-Item Env:\GIT_SSL_NO_VERIFY
```

---

## 提交前自查

```bash
cd D:\作业\实践周\talk-together
npm run check --prefix contracts   # 契约未被破坏
cd backend
npm run typecheck                  # 类型通过
npm test                           # 58 项全过
```

三项都通过再推，避免把坏代码带进主干。
