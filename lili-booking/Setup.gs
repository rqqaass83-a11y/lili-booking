/**
 * 一次性設定：建立工作表、觸發條件、圖文選單
 * 在 Apps Script 編輯器上方選擇函式後按「執行」。
 */

/** ① 建立工作表與欄位（可重複執行，不會清掉資料） */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  setProp_('SHEET_ID', ss.getId());
  var a = ss.getSheetByName('Appointments') || ss.insertSheet('Appointments');
  a.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#F3E9E2');
  a.setFrozenRows(1);
  [COL.date, COL.slot, COL.phone, COL.remindDate].forEach(function (c) { a.getRange(2, c, a.getMaxRows() - 1, 1).setNumberFormat('@'); });
  var s = ss.getSheetByName('Settings') || ss.insertSheet('Settings');
  s.getRange(1, 1, 1, 5).setValues([['公休日 (YYYY-MM-DD)', '', '鎖定日期', '鎖定時段', '備註']]).setFontWeight('bold').setBackground('#F3E9E2');
  s.getRange(2, 1, s.getMaxRows() - 1, 5).setNumberFormat('@');
  s.setFrozenRows(1);
  if (!prop_('WEBHOOK_KEY')) setProp_('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, '').substr(0, 20));
  if (!prop_('OWNER_PASSCODE')) setProp_('OWNER_PASSCODE', String(Math.floor(100000 + Math.random() * 900000)));
  console.log('完成。WEBHOOK_KEY=' + prop_('WEBHOOK_KEY') + '　店長通關碼=' + prop_('OWNER_PASSCODE'));
}

/** ② 建立每日排程（可重複執行，會先清掉舊的） */
function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['dailyMorningJob', 'ownerEveningJob'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyMorningJob').timeBased().everyDays(1).atHour(CONFIG.REMINDER_HOUR).inTimezone(CONFIG.TZ).create();
  ScriptApp.newTrigger('ownerEveningJob').timeBased().everyDays(1).atHour(CONFIG.OWNER_SUMMARY_HOUR).inTimezone(CONFIG.TZ).create();
  console.log('已建立每日 ' + CONFIG.REMINDER_HOUR + ' 點與 ' + CONFIG.OWNER_SUMMARY_HOUR + ' 點的排程');
}

/** ③ 檢查設定是否齊全 */
function checkConfig() {
  var need = ['CHANNEL_ACCESS_TOKEN', 'LOGIN_CHANNEL_ID', 'LIFF_ID', 'WEBHOOK_KEY', 'OWNER_PASSCODE', 'SHEET_ID'];
  var opt = ['CALENDAR_ID', 'OWNER_EMAIL', 'OWNER_UID', 'IG_URL', 'MAP_URL', 'OA_ADD_URL', 'PRICE_IMAGE_URL', 'CUSTOMER_MENU_ID', 'OWNER_MENU_ID'];
  need.forEach(function (k) { console.log((prop_(k) ? '✅ ' : '❌ 缺少 ') + k); });
  opt.forEach(function (k) { console.log((prop_(k) ? '✅ ' : '▫️ 未設定（選填） ') + k); });
  if (prop_('CHANNEL_ACCESS_TOKEN')) {
    var r = lineFetch_('https://api.line.me/v2/bot/info', { method: 'get' });
    console.log(r.ok ? '✅ LINE 連線成功：' + r.data.displayName : '❌ LINE Token 無效（' + r.code + '）');
  }
  console.log('Webhook 網址：<你的 Web App 網址>?key=' + prop_('WEBHOOK_KEY'));
}

// ───────── 圖文選單 ─────────
/** 2500×1686、3 欄 × 2 列的 6 格點擊區（01–06 由左至右、由上而下） */
function menuAreas_(actions) {
  var xs = [0, 833, 1666], ws = [833, 833, 834], out = [];
  for (var i = 0; i < 6; i++) {
    out.push({ bounds: { x: xs[i % 3], y: i < 3 ? 0 : 843, width: ws[i % 3], height: 843 }, action: actions[i] });
  }
  return out;
}
function msgAction_(text) { return { type: 'message', text: text }; }
function uriAction_(uri) { return { type: 'uri', uri: uri }; }

/** src 可以是圖片網址（GitHub Pages）或雲端硬碟檔案 ID */
function createMenu_(name, chatBarText, actions, src) {
  var blob = /^https?:\/\//.test(src) ? UrlFetchApp.fetch(src).getBlob() : DriveApp.getFileById(src).getBlob();
  var type = blob.getContentType();
  if (type !== 'image/png' && type !== 'image/jpeg') throw new Error('選單圖片需為 PNG 或 JPG');
  if (blob.getBytes().length > 1024 * 1024) throw new Error('選單圖片需小於 1MB，目前 ' + Math.round(blob.getBytes().length / 1024) + 'KB');
  var r = lineFetch_('https://api.line.me/v2/bot/richmenu', { json: {
    size: { width: 2500, height: 1686 }, selected: true, name: name, chatBarText: chatBarText, areas: menuAreas_(actions)
  } });
  if (!r.ok) throw new Error('建立選單失敗：' + r.text);
  var id = r.data.richMenuId;
  var up = lineFetch_('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', { bytes: blob.getBytes(), contentType: type });
  if (!up.ok) throw new Error('上傳選單圖片失敗（請確認尺寸為 2500×1686）：' + up.text);
  return id;
}

/**
 * ④ 顧客選單：把 Figma 匯出的圖上傳到 Google 雲端硬碟，將檔案 ID 填入後執行。
 *    會設為所有好友的預設選單。
 */
function createCustomerMenu() {
  var DRIVE_FILE_ID = CONFIG.PUBLIC_BASE + 'menu_customer.png'; // 也可改成雲端硬碟檔案 ID
  var id = createMenu_('LiLi 顧客選單', '預約・價目・作品集', [
    uriAction_(prop_('IG_URL') || 'https://www.instagram.com/'),   // 01 最新作品集
    msgAction_('價目與須知'),                                        // 02 價目與須知
    msgAction_('預約排程'),                                          // 03 預約排程
    msgAction_('預約查詢'),                                          // 04 預約查詢
    uriAction_(prop_('MAP_URL') || 'https://maps.google.com/'),     // 05 工作室指引
    uriAction_(liffUrl_())                                           // 06 線上即時預約
  ], DRIVE_FILE_ID);
  var old = prop_('CUSTOMER_MENU_ID');
  setProp_('CUSTOMER_MENU_ID', id);
  var r = lineFetch_('https://api.line.me/v2/bot/user/all/richmenu/' + id);
  if (old) lineFetch_('https://api.line.me/v2/bot/richmenu/' + old, { method: 'delete' });
  console.log(r.ok ? '顧客選單已上線：' + id : '設為預設失敗：' + r.text);
}

/**
 * ⑤ 店長選單：只有綁定為店長的帳號看得到。
 *    建立後請店長在聊天室傳「綁定店長 通關碼」。
 */
function createOwnerMenu() {
  var DRIVE_FILE_ID = CONFIG.PUBLIC_BASE + 'menu_owner.png'; // 也可改成雲端硬碟檔案 ID
  var id = createMenu_('LiLi 店長選單', '店長專用', [
    msgAction_('今日預約'),                      // 01 今日預約
    msgAction_('本週看板'),                      // 02 本週看板
    uriAction_(liffUrl_('view=lock')),           // 03 公休／鎖時段
    msgAction_('卸甲回訪名單'),                  // 04 卸甲回訪名單
    msgAction_('營收報表'),                      // 05 營收報表
    uriAction_(liffUrl_('view=adminbook'))       // 06 手動新增預約
  ], DRIVE_FILE_ID);
  var old = prop_('OWNER_MENU_ID');
  setProp_('OWNER_MENU_ID', id);
  if (prop_('OWNER_UID')) lineFetch_('https://api.line.me/v2/bot/user/' + prop_('OWNER_UID') + '/richmenu/' + id);
  if (old) lineFetch_('https://api.line.me/v2/bot/richmenu/' + old, { method: 'delete' });
  console.log('店長選單已建立：' + id + (prop_('OWNER_UID') ? '（已套用到店長帳號）' : '（請店長傳「綁定店長 ' + prop_('OWNER_PASSCODE') + '」）'));
}

/** 手動測試：把各種卡片推給店長看樣子（會用掉推播額度，每張 1 則） */
function sendSampleCardsToOwner() {
  var uid = prop_('OWNER_UID');
  if (!uid) throw new Error('請先完成店長綁定');
  var a = { id: 'LL0000-TST', date: addDays_(todayStr_(), 1), slot: CONFIG.SLOTS[0].label, slotId: 'S1', name: '測試', phone: '0912345678',
    main: '晶石貓眼', addons: '凝膠延甲×2指、本店卸甲', price: 1300, priceMax: 1300, note: '' };
  pushMessage_(uid, [confirmFlex_(a, 'new'), remindFlex_(a), careFlex_(a), slotsFlex_(), cancelAskFlex_(a)]);
}
