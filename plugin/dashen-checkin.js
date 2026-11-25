// 网易大神圈子签到 - 定时签到脚本 v2.0.0
// 用途: 读 dashen-capture.js 保存的签到请求, 原样重放一次.
//
// v2 修复 (2026-11-25, 根据持久化导出分析):
//   v1 只看 HTTP 2xx 就记成功, 结果把
//   /v1/exp/square/task/get-complement-sign-in-task-info
//   (补签任务查询) 的 200 也记成签到成功, 造成假成功、今日跳过.
//   v2 重放前先校验保存的 URL 必须是真签到接口, 成功判定改为
//   HTTP 2xx 且响应 code==200 且 result.completeStatus==true,
//   否则不写 dashen_last_success_date.
//   若保存的是错误接口, 还会先清掉之前误写的今日成功记录,
//   以免它继续让定时任务跳过.
//
// 关键限制:
//   GL-CheckSum / GL-Nonce / GL-Token 是动态的, 且 CheckSum 含 App 内嵌密钥,
//   Loon 脚本无法自行生成, 只能原样重放抓到的请求. 如果服务端校验时间 /
//   CheckSum, 重放会失败, 那就说明必须重新抓包, 不能靠定时重放解决.
//   失败时请看通知里的状态码和返回, 重新手动签一次再抓包.
//
// $argument: 插件对象参数, 例如 { autoSignin: true }
//   autoSignin 为 false 时跳过本次执行.

var STORE_KEY = "dashen_checkin_request";
var LAST_OK_KEY = "dashen_last_success_date";
var SIGNIN_RE = /^https:\/\/god-exp\.gameyw\.netease\.com\/v1\/exp\/user\/square\/signIn(\?|$)/;

function todayStr() {
  var d = new Date();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
}

function finish(title, subtitle, content) {
  console.log({ msg: "dashen checkin v2: " + title, subtitle: subtitle, content: content });
  $notification.post(title, subtitle || "", content || "");
  $done();
}

function parseResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function main() {
  try {
    var arg = (typeof $argument !== "undefined" && $argument) ? $argument : null;
    if (arg && typeof arg === "object" && arg.autoSignin === false) {
      finish("网易大神签到", "已跳过", "插件参数里关闭了自动签到");
      return;
    }

    var raw = $persistentStore.read(STORE_KEY);
    if (!raw) {
      finish(
        "网易大神签到",
        "未抓到签到请求",
        "请先开 MitM, 在大神 App 里手动签一次, 等到「已抓到签到请求」通知后再定时签到"
      );
      return;
    }

    var record;
    try {
      record = JSON.parse(raw);
    } catch (e) {
      finish("网易大神签到", "保存的请求已损坏", "请重新手动签一次, 重新抓包");
      return;
    }

    if (!record.url || !record.method) {
      finish("网易大神签到", "保存的请求不完整", "请重新手动签一次, 重新抓包");
      return;
    }

    // 先校验: 保存的必须是真签到接口, 否则是 v1 误存的补签查询等请求.
    // 这种情况要清掉之前误写的今日成功记录, 否则定时任务会一直跳过.
    if (!SIGNIN_RE.test(record.url)) {
      $persistentStore.write("", LAST_OK_KEY);
      finish(
        "网易大神签到",
        "保存的不是签到接口",
        "存的是 " + record.url.slice(0, 100) + "\n已清掉误写的今日成功记录, 请重新手动签一次再抓包"
      );
      return;
    }

    // 同一天已成功过就跳过, 避免重复签到触发风控.
    var today = todayStr();
    var lastOk = $persistentStore.read(LAST_OK_KEY);
    if (lastOk === today) {
      finish("网易大神签到", "今日已签过", "跳过本次定时执行, 明天再签");
      return;
    }

    // 重放时去掉由 $httpClient 自动生成的头, 其余头原样带上.
    var skipHeaders = {
      "host": 1, "content-length": 1, "accept-encoding": 1,
      "connection": 1, "content-length ": 1
    };
    var headers = {};
    var srcHeaders = record.headers || {};
    Object.keys(srcHeaders).forEach(function (k) {
      if (!skipHeaders[k.toLowerCase()]) headers[k] = srcHeaders[k];
    });

    var method = String(record.method).toUpperCase();
    var options = {
      url: record.url,
      headers: headers,
      timeout: 15000
    };
    if (record.body) options.body = record.body;

    console.log({
      msg: "dashen checkin v2: replaying",
      url: record.url,
      method: method,
      headerNames: Object.keys(headers),
      bodyLength: record.body ? String(record.body).length : 0,
      capturedAt: record.capturedAt || ""
    });

    var httpMethod = method === "POST" ? $httpClient.post : $httpClient.get;
    // $httpClient.get/post 的回调签名都是 (error, response, data)
    httpMethod.call($httpClient, options, function (error, response, data) {
      if (error) {
        finish("网易大神签到", "请求失败", String(error).slice(0, 200));
        return;
      }
      var status = response ? response.status : 0;
      var text = data ? String(data) : "";
      console.log({ msg: "dashen checkin v2: response", status: status, body: text.slice(0, 500) });

      var json = parseResponse(text);
      var hint = "";
      var detail = "";
      if (json) {
        if (typeof json.code !== "undefined") hint = "code=" + json.code + " ";
        if (json.errmsg) hint += String(json.errmsg).slice(0, 80);
        else if (json.msg) hint += String(json.msg).slice(0, 80);
        if (json.result) {
          if (typeof json.result.completeCount !== "undefined") detail += "已签" + json.result.completeCount + "次 ";
          if (typeof json.result.changeExp !== "undefined") detail += "+" + json.result.changeExp + "经验 ";
          if (typeof json.result.ranking !== "undefined") detail += "排名" + json.result.ranking;
        }
      } else {
        hint = text.slice(0, 80);
      }

      // 成功判定: HTTP 2xx 且 code==200 且 result.completeStatus==true.
      // 只看 2xx 会把补签查询之类的 200 也记成成功, v1 的假成功就是这么来的.
      var ok = status >= 200 && status < 300 && json && json.code === 200 &&
        json.result && json.result.completeStatus === true;
      if (ok) {
        $persistentStore.write(today, LAST_OK_KEY);
        finish("网易大神签到", "签到成功 (" + status + ")", (detail || hint || text.slice(0, 120)) + "\n请进 App 核对是否真的签上了");
      } else {
        finish(
          "网易大神签到",
          "签到未确认 (" + status + ")",
          (hint || text.slice(0, 120)) + "\n未记为今日成功, 可能是 GL-CheckSum / Token 过期, 请重新手动签一次再抓包"
        );
      }
    });
  } catch (e) {
    finish("网易大神签到", "脚本异常", String(e && e.message ? e.message : e).slice(0, 200));
  }
}

main();
