# 怎么运行（后端）

本文件面向第一次上手的人，命令可直接复制。全部命令都在 `backend/` 目录下执行。

环境要求：Node.js ≥ 24.15.0（已验证本机系统 Node 为 v24.15.0，可直接用）。

---

## 0. 第一次运行前：装依赖

只需做一次。以后再跑不用重复。

```bash
cd D:\作业\实践周\talk-together
npm ci --prefix contracts
npm install --prefix backend
```

说明：后端通过 `file:../contracts` 引用契约包，所以两个目录的依赖都要装。

---

## 1. 看完整流程（推荐先跑这个）

```bash
cd D:\作业\实践周\talk-together\backend
npm run demo
```

约 20 秒跑完，会真实启动后端并走完 28 个步骤：建房 → 邀请加入 → 聊天 → 幂等重试 →
限频 → AI 流式 → FIFO 串行 → 中途加入隔离 → 掉线恢复 → 移出 → 关房。

输出怎么读：

| 标记 | 含义 |
| --- | --- |
| `→ POST /api/v1/...` | 发出的 HTTP 请求 |
| `← 201` / `← 409 NICKNAME_TAKEN` | 响应状态与业务错误码 |
| `2391ms [房主] seq=28 ai.reply.started` | WebSocket 事件：时间、视角、序号、类型 |
| `✓` | 断言达成 |
| `✗` | 断言未达成（会计入结尾汇总并让进程退出码为 1） |

三个视角（房主 / 小周 / 小陈）分颜色显示，可以直接看出**谁收到了什么、谁没收到**。

结尾会打印一行结论：

```
全部断言达成，无未达预期项。
```

想把输出存成文件：

```bash
npm run demo > demo-output.txt 2>&1
```

不想自己跑，仓库里已有一份我跑过的留存结果：`backend/demo-output.txt`。

---

## 2. 看测试结果

```bash
cd D:\作业\实践周\talk-together\backend
npm test
```

预期输出末尾：

```
ℹ tests 58
ℹ pass 58
ℹ fail 0
```

只跑某一个文件：

```bash
node --test test/ws.test.ts          # 实时与流式，8 项
node --test test/http.test.ts        # 身份与入房，11 项
node --test test/idle.test.ts        # 冷场调度与边界，12 项
node --test test/recovery.test.ts    # 掉线恢复与超时关房，6 项
node --test test/error-codes.test.ts # 错误码盘点，20 项
node --test test/store.test.ts       # 状态存储可替换性，1 项
```

`error-codes.test.ts` 会额外打印错误码盘点清单，列出哪 22 个有真实触发路径、
哪 7 个未覆盖及原因——这份清单就是给 5 号验收核对用的。

---

## 3. 类型检查

```bash
npm run typecheck
```

没有任何输出就是通过。

---

## 4. 契约自检（在仓库根目录）

```bash
cd D:\作业\实践周\talk-together
npm run check --prefix contracts
```

预期：`11 operations, 49 models, 43 HTTP examples and 12 WS scenarios checked.`

这条确认契约本身没被改动，后端输出仍符合 v0.1.0。

---

## 5. 启动服务，自己用 curl 试

演练脚本跑完会自动关服务。想让它一直开着：

```bash
cd D:\作业\实践周\talk-together\backend
npm start
```

默认监听 `http://127.0.0.1:4000`，按 `Ctrl+C` 停止。

换端口：

```bash
# PowerShell
$env:PORT=5000; npm start

# cmd
set PORT=5000 && npm start
```

### 手动走一遍最小流程

另开一个终端。先取客户端配置（这条没有请求体，最简单）：

```bash
curl http://127.0.0.1:4000/api/v1/client-config
```

预期返回 `"contractVersion":"0.1.0"` 和各项校验上限。

**建房这步要注意引号转义**，不同终端规则不同，而且中文在 Git Bash 下可能因编码问题
被判为 `VALIDATION_ERROR`（实测如此）。建议先用纯英文昵称验证通路：

PowerShell（推荐，中文正常）：

```powershell
$body = @{
  clientRequestId = "11111111-1111-4111-8111-111111111111"
  bootstrapToken  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  profile = @{ nickname = "小林"; interestTags = @("阅读"); bio = "" }
} | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:4000/api/v1/rooms -Method Post `
  -ContentType "application/json; charset=utf-8" -Body $body
```

Git Bash（用英文昵称，避免编码问题）：

```bash
curl -X POST http://127.0.0.1:4000/api/v1/rooms \
  -H "content-type: application/json" \
  -d '{"clientRequestId":"11111111-1111-4111-8111-111111111111","bootstrapToken":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","profile":{"nickname":"test","interestTags":["read"],"bio":""}}'
```

> `bootstrapToken` 必须满足契约的 `Secret` 约束：`^[A-Za-z0-9_-]{32,}$`，
> 即只含字母数字和 `-_`，且至少 32 位。上面用的是 64 个 `a`。

从返回里记下三个值：`data.room.id`、`data.memberCredential`、
`data.member.membership.id`。

用这些凭证查自己（把尖括号内容替换成实际值）：

```bash
curl http://127.0.0.1:4000/api/v1/rooms/<房间ID>/members/me \
  -H "authorization: Bearer <memberCredential>"
```

发消息（需要同时带 Bearer 凭证和入房标识）：

```bash
curl -X POST http://127.0.0.1:4000/api/v1/rooms/<房间ID>/messages \
  -H "content-type: application/json" \
  -H "authorization: Bearer <memberCredential>" \
  -H "x-membership-id: <membershipId>" \
  -d '{"clientRequestId":"22222222-2222-4222-8222-222222222222","text":"hello"}'
```

**嫌转义麻烦就直接跑 `npm run demo`**，它用 Node 的 fetch 发请求，没有任何
shell 转义和编码问题，而且把 28 步都串好了。

---

## 6. 一条命令全部验证

```bash
cd D:\作业\实践周\talk-together && npm run check --prefix contracts && cd backend && npm run typecheck && npm test && npm run demo
```

四项依次通过即表示：契约未破坏、类型正确、58 项断言通过、端到端流程跑通。

---

## 常见问题

**`npm : 无法将"npm"项识别为...`**
终端没找到 Node。在看山工作台的终端里跑，或确认系统已安装 Node ≥ 24.15.0。

**`Cannot find package '@talk-together/contracts'`**
契约依赖没装。回到第 0 步执行 `npm ci --prefix contracts`。

**`EADDRINUSE: address already in use 127.0.0.1:4000`**
4000 端口被占用（可能是上次的服务没停干净）。换端口：`$env:PORT=5000; npm start`。
演练脚本用的是随机端口，不会撞车。

**curl 建房返回 `VALIDATION_ERROR`，但 fieldErrors 是空的**
通常是两种原因，实测都遇到过：
1. `bootstrapToken` 不满足 `^[A-Za-z0-9_-]{32,}$`（少于 32 位，或含别的字符）。
2. 在 Git Bash 里传中文参数时编码被破坏——换成英文昵称即可通过，
   或改用 PowerShell 的 `Invoke-RestMethod`。

直接跑 `npm run demo` 可完全绕开这两个问题。

**演练中出现红色 `✗`**
说明实际行为与契约预期不符。结尾汇总会列出具体哪一项，退出码为 1。
把那几行贴出来即可定位。

**输出是乱码或没有颜色**
换用 Windows Terminal 或 PowerShell 7；功能不受影响。
也可以重定向到文件后用编辑器看：`npm run demo > out.txt 2>&1`。

---

## 说明

- 演练里的 AI 文本来自**假插件**（固定内容、不接任何模型），验证的是后端的调度与
  事件逻辑（队列、串行、取消、可见性）。真实选题与话术由 3 号的能力实现提供，
  接口见 `src/application/capability.ts`。
- 演练把恢复期压到 2 秒、限频窗口压到 1.5 秒，否则要等 60 秒才能看到效果。
  生产配置在 `src/config.ts`，未改动。
