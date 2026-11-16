/**
 * LINE Messaging API：回覆、推播（含每月額度保護）、Webhook 路由、店長指令
 */

function liffUrl_(query) { return 'https://liff.line.me/' + prop_('LIFF_ID') + (query ? '?' + query : ''); }

function lineFetch_(url, opts) {
  opts = opts || {};
  var params = {
    method: opts.method || 'post', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + prop_('CHANNEL_ACCESS_TOKEN') }
  };
  if (opts.json) { params.contentType = 'application/json'; params.payload = JSON.stringify(opts.json); }
  if (opts.bytes) { params.contentType = opts.contentType; params.payload = opts.bytes; }
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode(), text = res.getContentText();
  if (code >= 300) console.error('LINE API ' + code + ' ' + url + ' ' + text);
  var data = {};
  try { data = JSON.parse(text || '{}'); } catch (e) {}
  return { ok: code < 300, code: code, data: data, text: text };
}

/** 回覆（不計入推播額度） */
function replyMessage_(replyToken, messages) {
  return lineFetch_('https://api.line.me/v2/bot/message/reply', { json: { replyToken: replyToken, messages: messages.slice(0, 5) } });
}

/** 推播（計入每月額度；接近上限就停發並記錄） */
function pushMessage_(uid, messages) {
  var key = 'PUSH_' + fmt_(NOW_(), 'yyyy-MM');
  var used = Number(prop_(key)) || 0;
  if (used + messages.length > CONFIG.PUSH_MONTHLY_LIMIT) {
    console.warn('本月推播已達上限 ' + used + '，略過 ' + uid);
    return { ok: false, code: 0, quota: true };
  }
  var r = lineFetch_('https://api.line.me/v2/bot/message/push', { json: { to: uid, messages: messages } });
  if (r.ok) setProp_(key, used + messages.length);
  return r;
}
function textMsg_(t) { return { type: 'text', text: String(t).substr(0, 4900) }; }

// ───────── Webhook ─────────
function handleWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    try {
      var uid = ev.source && ev.source.userId;
      if (!uid || !ev.replyToken) return;
      var msgs = null;
      if (ev.type === 'follow') msgs = [textMsg_(welcomeText_())];
      else if (ev.type === 'message' && ev.message && ev.message.type === 'text') msgs = routeText_(uid, ev.message.text);
      else if (ev.type === 'postback') msgs = routePostback_(uid, ev.postback && ev.postback.data);
      if (msgs && msgs.length) replyMessage_(ev.replyToken, msgs);
    } catch (err) { console.error('event ' + (err && err.stack || err)); }
  });
}

function welcomeText_() {
  return '歡迎加入 ' + CONFIG.STUDIO_NAME + ' ✨\n\n本店為全預約制，僅接受預約來店。\n' +
    '點選下方選單「線上即時預約」就能直接選日期與時段；要查詢、取消或改期，請點「預約查詢」。\n\n有任何問題也可以直接在這裡留言給我們。';
}

/** 文字訊息路由。回傳 null 代表不自動回覆（留給店長人工回覆） */
function routeText_(uid, raw) {
  var t = String(raw || '').trim();
  var isOwner = !!prop_('OWNER_UID') && uid === prop_('OWNER_UID');
  var m;

  if ((m = t.match(/^綁定店長\s+(\S+)$/))) return [textMsg_(bindOwner_(uid, m[1]))];

  // 預約頁送出後由客人自己發出的訊息 → 用免費的 reply 回確認單
  if ((m = t.match(/^我已(完成|改期)預約\s*#?(LL\d{4}-[A-Z0-9]{3})/))) {
    var a = findBooking_(m[2]);
    if (!a || a.uid !== uid || !isActive_(a)) return null;
    markConfirmSent_(a);
    return [confirmFlex_(a, m[1] === '改期' ? 'reschedule' : 'new')];
  }

  if (/^(預約查詢|我的預約|查詢預約|取消預約|取消|改期)$/.test(t)) return [bookingsFlex_(upcomingOf_(uid))];
  if (/^(預約排程|營業時間|空檔|即時空檔)$/.test(t)) return [slotsFlex_()];
  if (/^(價目與須知|價目表|價目|須知)$/.test(t)) return priceMessages_();

  if (isOwner) {
    if (/^(今日預約|今天)$/.test(t)) return [dayFlex_(todayStr_(), '今日預約')];
    if (/^(明日預約|明天)$/.test(t)) return [dayFlex_(addDays_(todayStr_(), 1), '明日行程總覽')];
    if (/^(本週看板|本週)$/.test(t)) return [textMsg_(weekText_())];
    if (/^(卸甲回訪名單|回訪名單)$/.test(t)) return [textMsg_(revisitText_())];
    if (/^(營收報表|營收)$/.test(t)) return [textMsg_(revenueText_())];
    if (/^(推播用量|用量)$/.test(t)) return [textMsg_('本月已推播 ' + (Number(prop_('PUSH_' + fmt_(NOW_(), 'yyyy-MM'))) || 0) + ' 則（上限 ' + CONFIG.PUSH_MONTHLY_LIMIT + '）')];
    if ((m = t.match(/^取消\s*#?(LL\d{4}-[A-Z0-9]{3})$/i))) {
      try { var c = cancelBooking_(m[1], { uid: uid, isOwner: true }); return [textMsg_('已取消 ' + c.id + '｜' + dateLabel_(c.date) + ' ' + c.slot + '｜' + c.name)]; }
      catch (e) { return [textMsg_(e.message || '取消失敗')]; }
    }
    if (/^(店長選單|指令)$/.test(t)) return [textMsg_('店長指令：\n今日預約／明日預約／本週看板\n卸甲回訪名單／營收報表／推播用量\n取消 LL1118-ABC（代客取消）\n\n公休與鎖時段、手動新增預約請點下方選單。')];
  }
  return null;
}

function parseData_(s) {
  var o = {};
  String(s || '').split('&').forEach(function (kv) { var i = kv.indexOf('='); if (i > 0) o[kv.substr(0, i)] = decodeURIComponent(kv.substr(i + 1)); });
  return o;
}

function routePostback_(uid, data) {
  var d = parseData_(data);
  var user = { uid: uid, isOwner: false };
  if (d.act === 'keep') return [textMsg_('好的，已為您保留預約 🙂')];
  if (d.act === 'cancel' || d.act === 'cancel_yes') {
    var a = findBooking_(d.id);
    if (!a || a.uid !== uid) return [textMsg_('找不到這筆預約，可能已經取消。')];
    if (a.status === STATUS.CANCELLED) return [textMsg_('這筆預約已經取消囉。')];
    if (d.act === 'cancel') return [cancelAskFlex_(a)];
    try { cancelBooking_(a.id, user); }
    catch (e) { return [textMsg_(e.message || '取消失敗，請直接傳訊息給我們。')]; }
    return [textMsg_('已為您取消 ' + dateLabel_(a.date) + ' ' + a.slot + ' 的預約（' + a.id + '）。\n期待下次為您服務，隨時歡迎再預約。')];
  }
  return null;
}

function priceMessages_() {
  var lines = ['【' + CONFIG.STUDIO_NAME + ' 價目】'];
  CATALOG.main.forEach(function (g) {
    lines.push('', '▍' + g.group);
    g.items.forEach(function (it) { lines.push(it.name + '　' + priceText_(it.min, it.max)); });
  });
  lines.push('', '▍加購');
  CATALOG.perFinger.forEach(function (p) { lines.push(p.name + '　+NT$' + p.price + '／指'); });
  CATALOG.removal.forEach(function (r) { if (r.price) lines.push(r.name + '　+NT$' + r.price); });
  lines.push('', '【預約須知】');
  CONFIG.NOTICES.forEach(function (n) { lines.push('・' + n); });
  var msgs = [];
  var img = prop_('PRICE_IMAGE_URL');
  if (img) msgs.push({ type: 'image', originalContentUrl: img, previewImageUrl: img });
  msgs.push(textMsg_(img ? lines.slice(lines.indexOf('【預約須知】')).join('\n') : lines.join('\n')));
  return msgs;
}

// ───────── 店長 ─────────
function bindOwner_(uid, pass) {
  var real = prop_('OWNER_PASSCODE');
  if (!real || pass !== real) return '綁定失敗，請確認通關碼。';
  setProp_('OWNER_UID', uid);
  var menu = prop_('OWNER_MENU_ID'), linked = false;
  if (menu) linked = lineFetch_('https://api.line.me/v2/bot/user/' + uid + '/richmenu/' + menu).ok;
  return '店長綁定完成 ✅' + (linked ? '\n已切換為店長專用選單。' : '\n（店長選單尚未建立，建立後再傳一次這句即可切換）') + '\n輸入「指令」可查看可用指令。';
}

function dayAppts_(date) {
  return readAppts_().filter(function (a) { return isActive_(a) && a.date === date; });
}

function weekText_() {
  var today = todayStr_(), d = today;
  while (dow_(d) !== 1) d = addDays_(d, -1); // 回到本週一
  if (dow_(today) === 6 || dow_(today) === 0) d = addDays_(d, 7); // 週末看下週
  var all = readAppts_().filter(isActive_), lines = ['【本週看板】'], total = 0;
  for (var i = 0; i < 5; i++, d = addDays_(d, 1)) {
    lines.push('', dateLabel_(d));
    CONFIG.SLOTS.forEach(function (sl) {
      var a = all.filter(function (x) { return x.date === d && x.slotId === sl.id; })[0];
      if (a) total++;
      lines.push(sl.start + '　' + (a ? a.name + '｜' + a.main : '—'));
    });
  }
  lines.push('', '共 ' + total + ' 位／' + 5 * CONFIG.SLOTS.length + ' 場');
  return lines.join('\n');
}

/** 已到 25 天、還沒再預約的客人 */
function revisitText_() {
  var today = todayStr_(), all = readAppts_().filter(isActive_), last = {};
  all.forEach(function (a) {
    var k = a.uid || a.phone;
    if (!k || a.date >= today) return;
    if (!last[k] || last[k].date < a.date) last[k] = a;
  });
  var rows = [];
  Object.keys(last).forEach(function (k) {
    var a = last[k];
    var hasNext = all.some(function (x) { return (x.uid || x.phone) === k && x.date >= today; });
    var days = Math.round((dateAt_(today, '12:00') - dateAt_(a.date, '12:00')) / 86400000);
    if (!hasNext && days >= CONFIG.REVISIT_DAYS && days <= 90) rows.push({ a: a, days: days });
  });
  rows.sort(function (x, y) { return y.days - x.days; });
  if (!rows.length) return '【卸甲回訪名單】\n目前沒有超過 ' + CONFIG.REVISIT_DAYS + ' 天未回訪的客人。';
  return '【卸甲回訪名單】（施作滿 ' + CONFIG.REVISIT_DAYS + ' 天、尚未再預約）\n\n' + rows.map(function (r) {
    return r.a.name + '　' + r.a.phone + '\n上次 ' + dateLabel_(r.a.date) + ' ' + r.a.main + '（' + r.days + ' 天前）';
  }).join('\n\n');
}

function revenueText_() {
  var all = readAppts_().filter(isActive_);
  var today = todayStr_();
  var block = function (ym, title) {
    var list = all.filter(function (a) { return a.date.substr(0, 7) === ym; });
    var done = list.filter(function (a) { return a.date < today; });
    var sum = function (l, f) { return l.reduce(function (s, a) { return s + a[f]; }, 0); };
    var cnt = {};
    list.forEach(function (a) { cnt[a.main] = (cnt[a.main] || 0) + 1; });
    var top = Object.keys(cnt).sort(function (x, y) { return cnt[y] - cnt[x]; }).slice(0, 5)
      .map(function (k) { return '・' + k + ' ×' + cnt[k]; });
    return [title + '（' + ym + '）', '預約 ' + list.length + ' 筆（已完成 ' + done.length + ' 筆）',
      '預估營收 ' + priceText_(sum(list, 'price'), sum(list, 'priceMax')),
      '其中已完成 ' + priceText_(sum(done, 'price'), sum(done, 'priceMax'))].concat(top).join('\n');
  };
  var ym = today.substr(0, 7);
  var prev = addDays_(ym + '-01', -1).substr(0, 7);
  return '【營收報表】\n金額為預約時的預估，實收請以現場為準。\n\n' + block(ym, '本月') + '\n\n' + block(prev, '上月');
}
