# Issue tracker: GitHub

本仓库的任务和规格存放在 GitHub Issues，使用 gh CLI 操作。
目标仓库：jasper0507/talk-together。

## 操作约定

在仓库根目录运行命令，由 gh 根据 git remote 推断目标仓库。
在其他目录运行时，显式传入 --repo jasper0507/talk-together。

- 创建：gh issue create --title "..." --body-file <正文文件>
- 读取：gh issue view <number> --comments
- 获取正文、标签和讨论：gh issue view <number> --json number,title,body,labels,comments
- 列表：gh issue list --state open --json number,title,body,labels
- 评论：gh issue comment <number> --body-file <正文文件>
- 添加标签：gh issue edit <number> --add-label "<label>"
- 移除标签：gh issue edit <number> --remove-label "<label>"
- 关闭：gh issue close <number>

多行正文先写入临时文件，再通过 --body-file 传入。
标签映射见 triage-labels.md。

技能要求“发布到 issue tracker”时，创建 GitHub Issue。
技能要求“获取相关 ticket”时，读取对应 Issue 的正文、标签和评论。

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Wayfinding operations

供 /wayfinder 使用：

- Map：一个带 wayfinder:map 标签的 Issue，正文包含
  Notes、Decisions-so-far 和 Fog。
- 子任务：优先使用 GitHub sub-issues 关联 Map；
  不可用时，在 Map 正文维护任务列表，并在子任务顶部写 Part of #<map>。
- 类型：使用 wayfinder:<type> 标签；
  type 为 research、prototype、grilling 或 task。
- 阻塞关系：优先使用 GitHub 原生 Issue dependencies；
  不可用时，在子任务顶部写 Blocked by: #<n>, #<n>。
  所有阻塞任务关闭后，该任务才可开始。
- 下一项：按 Map 顺序选择未关闭、无未解决阻塞且无人认领的子任务。
- 认领：开始工作前运行 gh issue edit <number> --add-assignee @me。
- 完成：评论记录结果，关闭子任务，再向 Map 的 Decisions-so-far
  追加结论和链接。
