// 网易大神圈子签到 - 抓取脚本 v2.1.0
// 用途: 在你手动签到时, 把那次签到请求的 URL / 方法 / 请求头 / 请求体
// 保存到本机 $persistentStore, 供定时签到脚本重放.
// 同时在脚本日志里输出抓到的内容 (敏感值只显示前 4 / 后 4 位, 其余打码),
// 这样不用去持久化里翻, 在 Loon 的脚本日志里就能直接看到抓到了什么.
// Token 等敏感信息只保存在本机, 不会发给任何人, 日志里也不打印完整值.
//
// v2 修复 (2026-11-25, 根据 HAR 与持久化导出分析):
//   v1 用 "sign" 关键字宽泛匹配, 把 H5 的
//   /v1/exp/square/task/get-complement-sign-in-task-info
//   (补签任务查询, 来自 act.ds.163.com, 无 GL-CheckSum) 也存下来了,
//   还覆盖了真签到请求. v2 只认精确的签到接口, 且必须带 GL-CheckSum.
//
// 真签到接口 (2026-11-17 HAR 已确认):
//   POST https://god-exp.gameyw.netease.com/v1/exp/user/square/signIn
//   Body: {"squareId":"..."}

var STORE_KEY = "dashen_checkin_request";
var META_KEY = "dashen_checkin_meta";
var SIGNIN_RE = /^https:\/\/god-exp\.gameyw\.netease\.com\/v1\/exp\/user\/square\/signIn(\?|$)/;

function getHeader(headers, name) {
  var lower = name.toLowerCase();
  var keys = Object.keys(headers || {});
  for (var i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === lower) return headers[keys[i]];
  }
  return "";
}

// 敏感值脱敏: 只留前 4 位和后 4 位, 中间打码. 短值直接打码.
function mask(v) {
  if (!v) return "";
  v = String(v);
  if (v.length <= 8) return "****";
  return v.slice(0, 4) + "****" + v.slice(-4);
}

// 抓到的内容输出到脚本日志: URL / 方法 / Body / 关键头 (脱敏).
// 在 Loon 里看日志: 配置 -> 脚本 -> 找到"大神签到抓取" -> 日志.
function logCaptured(record) {
  var headers = record.headers || {};
  var maskedHeaders = {};
  Object.keys(headers).forEach(function (k) {
    var lower = k.toLowerCase();
    // GL-Token / GL-CheckSum / Cookie 这类敏感头只显示前后 4 位.
    if (lower.indexOf("token") !== -1 || lower.indexOf("checksum") !== -1 ||
        lower.indexOf("cookie") !== -1 || lower.indexOf("auth") !== -1) {
      maskedHeaders[k] = mask(headers[k]);
    } else {
      maskedHeaders[k] = headers[k];
    }
  });
  console.log({
    msg: "dashen capture: 抓到的内容",
    url: record.url,
    method: record.method,
    body: record.body,
    squareId: getHeader(headers, "gl-activesquareid") || "",
    glCurTime: getHeader(headers, "gl-curtime") || "",
    glCheckSum: mask(getHeader(headers, "gl-checksum")),
    glUid: mask(getHeader(headers, "gl-uid")),
    glToken: mask(getHeader(headers, "gl-token")),
    glVersion: getHeader(headers, "gl-version") || "",
    capturedAt: record.capturedAt,
    headers: maskedHeaders
  });
}

function main() {
  try {
    var url = $request.url || "";
    var method = ($request.method || "POST").toUpperCase();
    var headers = $request.headers || {};
    var body = "";
    if (typeof $request.body !== "undefined" && $request.body !== null) {
      body = typeof $request.body === "string" ? $request.body : String($request.body);
    }

    // 1. 只认精确的签到接口, 其他含 "sign" 的接口 (如补签任务查询) 一律跳过.
    if (!SIGNIN_RE.test(url)) {
      console.log({ msg: "dashen capture v2: skipped, not signIn endpoint", url: url });
      $done({});
      return;
    }

    // 2. 拒绝 H5 WebView 请求 (来源 act.ds.163.com, UA 以 Mozilla 开头).
    //    真签到是 App 原生请求, UA 不是 Mozilla, 也没有 referer.
    var referer = getHeader(headers, "referer") || getHeader(headers, "origin") || "";
    var ua = getHeader(headers, "user-agent") || "";
    if (referer.indexOf("act.ds.163.com") !== -1 || ua.indexOf("Mozilla/") === 0) {
      console.log({ msg: "dashen capture v2: skipped, webview request", url: url, referer: referer });
      $done({});
      return;
    }

    // 3. 必须带 GL-CheckSum 和 GL-CurTime, 否则不是可重放的真签到请求.
    var checksum = getHeader(headers, "gl-checksum");
    var curtime = getHeader(headers, "gl-curtime");
    if (!checksum || !curtime) {
      console.log({ msg: "dashen capture v2: skipped, missing GL-CheckSum/CurTime", url: url });
      $done({});
      return;
    }

    // 4. Body 里必须有 squareId.
    if (body.indexOf("squareId") === -1) {
      console.log({ msg: "dashen capture v2: skipped, body has no squareId", url: url });
      $done({});
      return;
    }

    var record = {
      url: url,
      method: method,
      headers: headers,
      body: body,
      capturedAt: new Date().toISOString(),
      capturedAtMs: Date.now()
    };

    var saved = $persistentStore.write(JSON.stringify(record), STORE_KEY);

    var meta = {
      url: url,
      method: method,
      headerNames: Object.keys(headers),
      hasGLToken: !!getHeader(headers, "gl-token"),
      hasGLUid: !!getHeader(headers, "gl-uid"),
      hasGLChecksum: !!checksum,
      hasGLCurTime: !!curtime,
      hasGLActiveSquareId: !!getHeader(headers, "gl-activesquareid"),
      bodyLength: body ? body.length : 0,
      capturedAt: record.capturedAt
    };
    $persistentStore.write(JSON.stringify(meta), META_KEY);

    // 在脚本日志里输出抓到的完整内容 (敏感值已脱敏), 方便直接核对.
    logCaptured(record);

    console.log({
      msg: "dashen capture v2: saved",
      saved: saved,
      url: url,
      method: method,
      headerNames: meta.headerNames,
      bodyLength: meta.bodyLength
    });

    // 通知里显示方法和 URL, 再加 squareId, 不显示 Token.
    var squareId = "";
    try {
      squareId = JSON.parse(body).squareId || "";
    } catch (e) {
      squareId = "";
    }
    $notification.post(
      "网易大神签到",
      "已抓到签到请求",
      method + " " + url.slice(0, 120) + (squareId ? "\nsquareId=" + squareId : "")
    );
  } catch (e) {
    console.log({ msg: "dashen capture v2: error", error: String(e && e.message ? e.message : e) });
    $notification.post("网易大神签到", "抓取失败", String(e && e.message ? e.message : e).slice(0, 120));
  }
  // $done({}) 表示不改动本次请求, 原样放行.
  $done({});
}

main();
