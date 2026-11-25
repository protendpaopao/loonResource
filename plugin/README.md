# 网易大神圈子签到 - Loon 插件 v2（抓取版）

## 先说结论

网上没有找到现成可用的网易大神圈子签到插件。2026-11-17 的 HAR 已确认真签到接口是：

```
POST https://god-exp.gameyw.netease.com/v1/exp/user/square/signIn?ts=…&uf=…&ab=…&ef=…
Body: {"squareId":"678f9580659ccd410b712e44"}
```

`GL-CheckSum` 是 40 位 SHA1 形状，用已知字段简单拼接试算无法复现，含 App 内嵌密钥；
`GL-Nonce`、`uf`、`ab`、`ef` 每次请求都不同，所以 Loon 脚本无法凭空生成一次新的有效签到，
只能**先抓包，再定时重放**。

1. 你手动签一次，插件把那次请求的 URL / 方法 / 请求头 / 请求体保存到本机
2. 每天定时（默认 8:10）原样重放一次
3. 如果 `GL-CheckSum` 跟时间 / 请求体绑定，重放会失败——这需要实测才能确认，
   失败时重新手动签一次、重新抓包即可

Token 只保存在本机 `$persistentStore`，不会发给任何人，日志和通知里也不打印完整值。

## v2 修复了 v1 的两个 bug

v1 用 `sign` 关键字宽泛匹配，2026-11-25 的持久化导出证明它把 H5 的
`POST /v1/exp/square/task/get-complement-sign-in-task-info`（补签任务查询，
来自 `act.ds.163.com`，无 `GL-CheckSum`）也存下来了，还覆盖了真签到请求；
定时脚本又只看 HTTP 2xx 就记成功，把这次查询的 200 记成签到成功，
`dashen_last_success_date` 被误写为当天，之后定时任务一直跳过，实际根本没签上。

v2 改为：

- 抓取只认精确的签到接口 `god-exp.gameyw.netease.com/v1/exp/user/square/signIn`，
  拒绝 H5 WebView 请求（来源 `act.ds.163.com`、UA 以 `Mozilla/` 开头），
  必须带 `GL-CheckSum` 和 `GL-CurTime`、Body 里有 `squareId` 才保存
- 定时重放前先校验保存的 URL 必须是签到接口；如果是 v1 误存的旧记录，
  会先清掉误写的今日成功记录，再提示重新抓包
- 成功判定改为 HTTP 2xx 且响应 `code==200` 且 `result.completeStatus==true`，
  否则不记为今日成功

## 文件

- `NetEaseDashenCheckin.lpx` — 插件入口，Loon 3.5.1 (983) + 新版 Script 语法
- `dashen-capture.js` — 抓取脚本，手动签到时触发
- `dashen-checkin.js` — 定时签到脚本，每天 cron 重放
- `README.md` — 本文件

插件里的脚本用的是 GitHub 远端完整路径，例如
`script("https://raw.githubusercontent.com/protendpaopao/loonResource/main/plugin/dashen-capture.js")`，
不要改成相对路径 `dashen-capture.js`，实测那样引用不到。

## 安装

### 1. 托管这三个文件

本插件已托管在 GitHub 仓库 `protendpaopao/loonResource` 的 `plugin/` 目录，
`.lpx` 的 Raw 地址是：

```
https://raw.githubusercontent.com/protendpaopao/loonResource/main/plugin/NetEaseDashenCheckin.lpx
```

`.lpx` 里的脚本已经写成上面这个仓库的远端完整路径，不用再改。

注意：仓库目前是私有空仓库（2026-11-25 删旧建新后未上传），上面这个 Raw 地址
暂时拉不到文件。先定好托管方式、把 v2 文件传上去之后，再用这个地址导入。

### 2. 开 MitM，装证书

Loon → 配置 → MitM → 开启，按提示安装并信任 CA 证书：
iOS 设置 → 通用 → 关于本机 → 证书信任设置 → 开启对 Loon 证书的信任。
不开 MitM 抓不到 HTTPS 的签到请求。

### 3. 导入插件

Loon → 配置 → 插件 → 右上角 + → 从 URL 添加，粘贴上面第 1 步的 `.lpx` 地址，保存并启用。

插件参数：
- 签到时间：Cron 表达式，默认 `10 8 * * *`（每天 8:10）
- 自动签到：默认开。关掉就是只抓包、不自动签。

### 4. 手动签一次，抓包

1. 确认插件已启用，Loon 处于连接状态
2. 打开网易大神 App，手动签到一次（我 → 影响力 → 签到，或圈子页顶部的签到入口）
   注意：不要在 App 里的 H5 活动页（`act.ds.163.com`）点补签，那个不是真签到，v2 会直接跳过不存
3. 等到通知「网易大神签到 / 已抓到签到请求」，通知里会带 squareId。
   想看抓到的完整内容，不用去持久化里翻：Loon → 配置 → 脚本 → 找到「大神签到抓取」→
   看日志，里面有一条 `dashen capture: 抓到的内容`，包括 URL、方法、Body、
   squareId、GL-CurTime，以及脱敏后的 GL-CheckSum / GL-Uid / GL-Token
   （只显示前 4 / 后 4 位）和全部请求头。
4. 没收到通知 = 这次签到没走到签到接口，去 Loon 的脚本日志里看一下实际请求的域名，
   把那个域名告诉我，我再加到 `[Mitm]` 和抓取规则里

### 5. 手动跑一次定时任务，验证重放

Loon → 配置 → 脚本（或插件详情里的定时任务）→ 找到「大神圈子签到」→ 手动执行一次。

- 通知显示签到成功 + 已签次数 / 经验：进 App 核对圈子是不是真的显示已签到
- 通知显示「保存的不是签到接口」：说明存的还是 v1 的旧记录，按通知说的重新手动签一次再抓包
- 通知显示签到未确认 / 401 / 403 / CheckSum 相关错误：说明重放被服务端拒绝了，
  重新手动签一次、重新抓包，再跑一次；如果每次重放都失败，说明这个接口
  不能靠重放签到，需要另外找 CheckSum 生成方式

### 6. 之后每天自动签

验证通过后就不用管了，每天 8:10 自动跑一次。
同一天已成功过会跳过，避免重复签到。

## 如果要改签到时间

在插件参数里改「签到时间」，例如每天 9:00 就是 `0 9 * * *`。

## 已知限制

- 只签你手动签到时抓到的那一个圈子 / 那一个接口。如果你在多个圈子签到，
  抓包会保存最后一次的请求；多圈子需要抓多次、存多条记录，v2 暂不支持，
  等你实测抓到第一条的 URL 结构后，我再改成多圈子版。
- `GL-CheckSum` / `GL-Token` 过期后重放会失败，这是网易接口本身的限制，
  不是插件 bug。失败时重新抓包是最直接的办法。
- 需要 Loon 3.5.1 (983) 或更高版本，新版 Script 语法。
  Cron 写法参考官方文档：`cron "0 8 * * *" then script("cron.js") with tag="Daily Task", timeout=300`
