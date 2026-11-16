/**
 * Web App 入口：LIFF 前端的 API ＋ LINE Webhook 共用同一個網址
 * 部署設定：執行身分＝我、存取權＝所有人
 */

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'ping';
  try {
    if (action === 'config') return json_({ ok: true, config: clientConfig_() });
    return json_({ ok: true, service: 'LiLi booking', time: fmt_(NOW_(), 'yyyy-MM-dd HH:mm') });
  } catch (err) { return json_(errorOut_(err)); }
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'BAD_REQUEST', message: '格式錯誤' }); }
  if (body && body.events) { // LINE Webhook
    var key = prop_('WEBHOOK_KEY');
    if (key && (!e.parameter || e.parameter.key !== key)) return json_({ ok: false });
    try { handleWebhook_(body); } catch (err) { console.error('webhook ' + (err && err.stack || err)); }
    return json_({ ok: true });
  }
  try { return json_(handleApi_(body || {})); }
  catch (err) { return json_(errorOut_(err)); }
}

function errorOut_(err) {
  if (err instanceof AppError) return { ok: false, error: err.code, message: err.message };
  console.error(err && err.stack || err);
  return { ok: false, error: 'ERROR', message: '系統發生錯誤，請稍後再試或直接傳訊息給我們' };
}

function clientConfig_() {
  return {
    studio: CONFIG.STUDIO_NAME, hours: CONFIG.HOURS_TEXT, slots: CONFIG.SLOTS, catalog: CATALOG,
    notices: CONFIG.NOTICES, privacy: CONFIG.PRIVACY_TEXT, maxAdvanceDays: CONFIG.MAX_ADVANCE_DAYS,
    today: todayStr_(), oaUrl: prop_('OA_ADD_URL')
  };
}

/** 用 LIFF 的 ID token 向 LINE 驗證身分，UID 以 LINE 回傳的為準（前端無法偽造） */
function authUser_(idToken) {
  if (!idToken) throw new AppError('AUTH', '請從 LINE 內開啟預約頁');
  var cache = CacheService.getScriptCache();
  var ck = 'tk_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  var hit = cache.get(ck), info;
  if (hit) info = JSON.parse(hit);
  else {
    var res = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'post', payload: { id_token: idToken, client_id: prop_('LOGIN_CHANNEL_ID') }, muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new AppError('AUTH', '登入已過期，請關閉後重新開啟預約頁');
    var d = JSON.parse(res.getContentText());
    if (!d.sub) throw new AppError('AUTH', '無法確認 LINE 身分');
    info = { uid: d.sub, name: d.name || '' };
    cache.put(ck, JSON.stringify(info), 600);
  }
  info.isOwner = !!prop_('OWNER_UID') && info.uid === prop_('OWNER_UID');
  return info;
}
function requireOwner_(user) { if (!user.isOwner) throw new AppError('FORBIDDEN', '此功能僅限店長使用'); }

function handleApi_(body) {
  var action = body.action;
  if (action === 'config') return { ok: true, config: clientConfig_() };

  var user = authUser_(body.idToken);
  var today = todayStr_();
  var range = function (admin, excludeId) {
    return availability_(today, addDays_(today, CONFIG.MAX_ADVANCE_DAYS),
      { leadHours: admin && user.isOwner ? 0 : null, excludeId: excludeId });
  };
  var mine = function () { return upcomingOf_(user.uid).map(publicBooking_); };

  switch (action) {
    case 'init':
      return { ok: true, config: clientConfig_(), user: { name: user.name, isOwner: user.isOwner },
        days: range(body.admin, body.excludeId), bookings: mine() };
    case 'availability':
      return { ok: true, days: range(body.admin, body.excludeId) };
    case 'myBookings':
      return { ok: true, bookings: mine() };
    case 'book':
      var a = createBooking_(body, user);
      return { ok: true, booking: publicBooking_(a) };
    case 'cancel':
      return { ok: true, booking: publicBooking_(cancelBooking_(body.id, user)), bookings: mine() };
    case 'reschedule':
      return { ok: true, booking: publicBooking_(rescheduleBooking_(body.id, body.date, body.slotId, user)), bookings: mine() };
    case 'confirmPush': // 前端 liff.sendMessages 失敗時的備援（會用掉 1 則推播）
      var b = ownBooking_(body.id, user);
      if (b.uid && !confirmSent_(b)) { pushMessage_(b.uid, [confirmFlex_(b, body.kind)]); markConfirmSent_(b); }
      return { ok: true };
    case 'locks':
      requireOwner_(user); return { ok: true, locks: listLocks_() };
    case 'addLock':
      requireOwner_(user); return { ok: true, locks: addLock_(body.date, body.slotId, body.note), days: range(true) };
    case 'removeLock':
      requireOwner_(user); return { ok: true, locks: removeLock_(body.date, body.slotId), days: range(true) };
  }
  throw new AppError('BAD_REQUEST', '未知的操作');
}

// 確認單只發一次（reply 與 push 備援互斥）
function confirmKey_(a) { return 'conf_' + a.id + '_' + a.date + '_' + a.slotId; }
function confirmSent_(a) { return !!CacheService.getScriptCache().get(confirmKey_(a)); }
function markConfirmSent_(a) { CacheService.getScriptCache().put(confirmKey_(a), '1', 900); }
