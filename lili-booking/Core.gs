/**
 * 核心邏輯：日期工具、價格計算、空檔計算、預約／取消／改期、公休與鎖時段
 */

var NOW_ = function () { return new Date(); }; // 測試時可覆寫

function AppError(code, message) { this.code = code; this.message = message; }
AppError.prototype = Object.create(Error.prototype);

// ───────── 日期工具（台北時間，無日光節約） ─────────
function fmt_(d, f) { return Utilities.formatDate(d, CONFIG.TZ, f); }
function todayStr_() { return fmt_(NOW_(), 'yyyy-MM-dd'); }
function isDateStr_(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dateAt_(s, '12:00').getTime()) && fmt_(dateAt_(s, '12:00'), 'yyyy-MM-dd') === s; }
function dateAt_(dateStr, hm) { return new Date(dateStr + 'T' + hm + ':00+08:00'); }
function dow_(dateStr) { return dateAt_(dateStr, '12:00').getUTCDay(); }
function addDays_(dateStr, n) { return fmt_(new Date(dateAt_(dateStr, '12:00').getTime() + n * 86400000), 'yyyy-MM-dd'); }
function dateLabel_(dateStr) {
  var p = dateStr.split('-');
  return Number(p[1]) + '/' + Number(p[2]) + '（' + '日一二三四五六'.charAt(dow_(dateStr)) + '）';
}
function num_(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function priceText_(min, max) { return 'NT$' + num_(min) + (max > min ? '–' + num_(max) : ''); }
function slotById_(id) { for (var i = 0; i < CONFIG.SLOTS.length; i++) if (CONFIG.SLOTS[i].id === id) return CONFIG.SLOTS[i]; return null; }
function slotByLabel_(label) {
  var k = String(label).replace(/[–—~～]/g, '-').replace(/\s/g, '');
  for (var i = 0; i < CONFIG.SLOTS.length; i++) if (CONFIG.SLOTS[i].label === k) return CONFIG.SLOTS[i];
  var m = k.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/); // 自填時間
  if (m) return { id: 'CUSTOM', label: k, start: m[1], end: m[2], custom: true };
  return null;
}
function hmAdd_(hm, minutes) {
  var t = Number(hm.substr(0, 2)) * 60 + Number(hm.substr(3, 2)) + minutes;
  return (t < 600 ? '0' : '') + Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60);
}
/** 自填時間 → 時段物件（不佔固定場次） */
function customSlot_(hm) {
  var c = CONFIG.CUSTOM_SLOT;
  if (!c || !c.enabled) throw new AppError('INVALID', '目前不開放自填時間');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hm || ''))) throw new AppError('INVALID', '請填寫希望的開始時間（例：19:00）');
  if (hm < c.earliest || hm > c.latest) throw new AppError('INVALID', '自填時間請在 ' + c.earliest + '–' + c.latest + ' 之間');
  var end = hmAdd_(hm, c.minutes);
  return { id: 'CUSTOM', label: hm + '-' + end, start: hm, end: end, custom: true };
}

// ───────── 試算表 ─────────
function ss_() {
  var id = prop_('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new AppError('SETUP', '找不到工作表 ' + name + '，請先執行 setup()');
  return sh;
}
function cellDate_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return fmt_(v, 'yyyy-MM-dd');
  return String(v == null ? '' : v).trim().replace(/\//g, '-');
}
function cellPhone_(v) {
  var s = String(v == null ? '' : v).trim();
  if (/^9\d{8}$/.test(s)) s = '0' + s; // 被試算表吃掉開頭的 0
  return s;
}

/** 讀出所有預約（物件陣列，row 為試算表列號） */
function readAppts_() {
  var sh = sheet_('Appointments');
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (!v[COL.id - 1] && !v[COL.date - 1]) continue;
    var slot = slotByLabel_(v[COL.slot - 1]);
    var price = Number(v[COL.price - 1]) || 0;
    out.push({
      row: i + 2,
      id: String(v[COL.id - 1]).trim(),
      date: cellDate_(v[COL.date - 1]),
      slot: slot ? slot.label : String(v[COL.slot - 1]),
      slotId: slot ? slot.id : '',
      name: String(v[COL.name - 1]),
      phone: cellPhone_(v[COL.phone - 1]),
      uid: String(v[COL.uid - 1]).trim(),
      main: String(v[COL.main - 1]),
      addons: String(v[COL.addons - 1]),
      price: price,
      priceMax: Number(v[COL.priceMax - 1]) || price,
      remindDate: cellDate_(v[COL.remindDate - 1]),
      remindStatus: String(v[COL.remindStatus - 1]),
      status: String(v[COL.status - 1]).trim() || STATUS.BOOKED, // 店長手動在試算表新增時可不填
      eventId: String(v[COL.eventId - 1]),
      tomorrowStatus: String(v[COL.tomorrowStatus - 1]),
      note: String(v[COL.note - 1])
    });
  }
  return out;
}
function isActive_(a) { return a.status !== STATUS.CANCELLED; }
function isPending_(a) { return a.status === STATUS.PENDING; }
function setCell_(row, col, val) { sheet_('Appointments').getRange(row, col).setValue(val); }

function publicBooking_(a) {
  return {
    id: a.id, date: a.date, dateLabel: dateLabel_(a.date), slot: a.slot, slotId: a.slotId,
    main: a.main, addons: a.addons, price: a.price, priceMax: a.priceMax,
    priceText: priceText_(a.price, a.priceMax), status: a.status, name: a.name, pending: isPending_(a)
  };
}

// ───────── 公休、鎖時段、日曆 ─────────
function readSettings_() {
  var sh = sheet_('Settings');
  var last = Math.max(sh.getLastRow(), 1);
  var holidays = [], locks = [];
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 5).getValues();
    for (var i = 0; i < vals.length; i++) {
      var h = cellDate_(vals[i][0]);
      if (h) holidays.push(h);
      var d = cellDate_(vals[i][2]);
      if (d) {
        var s = slotByLabel_(vals[i][3]) || slotById_(String(vals[i][3]).trim());
        if (s) locks.push({ date: d, slotId: s.id, slot: s.label, note: String(vals[i][4]) });
      }
    }
  }
  return { holidays: holidays, locks: locks };
}
function writeSettings_(holidays, locks) {
  var sh = sheet_('Settings');
  var last = Math.max(sh.getLastRow(), 2);
  sh.getRange(2, 1, last - 1, 5).clearContent();
  holidays.sort();
  locks.sort(function (a, b) { return (a.date + a.slotId) < (b.date + b.slotId) ? -1 : 1; });
  var n = Math.max(holidays.length, locks.length);
  if (!n) return;
  var rows = [];
  for (var i = 0; i < n; i++) {
    var l = locks[i];
    rows.push([holidays[i] || '', '', l ? l.date : '', l ? l.slot : '', l ? l.note : '']);
  }
  sh.getRange(2, 1, n, 5).setNumberFormat('@').setValues(rows);
}

function cal_() {
  try {
    var id = prop_('CALENDAR_ID');
    return id ? CalendarApp.getCalendarById(id) : CalendarApp.getDefaultCalendar();
  } catch (e) { return null; }
}
/** 日曆上「不是本系統建立」的活動 → 佔用的時段與整天公休 */
function calendarBlocks_(from, to) {
  var res = { slots: {}, days: {} };
  var cal = cal_();
  if (!cal) return res;
  var events;
  try { events = cal.getEvents(dateAt_(from, '00:00'), dateAt_(addDays_(to, 1), '00:00')); }
  catch (e) { return res; }
  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    if (ev.getTag('lili')) continue; // 系統自己建立的預約，已由試算表計算
    if (ev.isAllDayEvent()) {
      if (!CONFIG.ALLDAY_EVENT_BLOCKS_DAY) continue;
      var d = fmt_(ev.getAllDayStartDate(), 'yyyy-MM-dd'), end = fmt_(ev.getAllDayEndDate(), 'yyyy-MM-dd');
      for (var g = 0; d < end && g < 400; g++) { res.days[d] = true; d = addDays_(d, 1); }
      continue;
    }
    var s = ev.getStartTime().getTime(), e2 = ev.getEndTime().getTime();
    var day = fmt_(ev.getStartTime(), 'yyyy-MM-dd'), lastDay = fmt_(ev.getEndTime(), 'yyyy-MM-dd');
    for (var k = 0; day <= lastDay && k < 400; k++) {
      for (var j = 0; j < CONFIG.SLOTS.length; j++) {
        var sl = CONFIG.SLOTS[j];
        if (s < dateAt_(day, sl.end).getTime() && e2 > dateAt_(day, sl.start).getTime()) res.slots[day + '|' + sl.id] = true;
      }
      day = addDays_(day, 1);
    }
  }
  return res;
}

// ───────── 空檔 ─────────
/**
 * 回傳 from～to 每一天的狀態。
 * status：open 可預約／full 額滿／closed 公休／past 已過或來不及
 * opts.leadHours：最少提前幾小時；opts.excludeId：改期時忽略自己那筆
 */
function availability_(from, to, opts) {
  opts = opts || {};
  var lead = opts.leadHours == null ? CONFIG.MIN_LEAD_HOURS : opts.leadHours;
  var today = todayStr_(), nowMs = NOW_().getTime();
  var maxDate = addDays_(today, CONFIG.MAX_ADVANCE_DAYS);
  var taken = {};
  readAppts_().forEach(function (a) {
    if (isActive_(a) && a.slotId !== 'CUSTOM' && a.id !== opts.excludeId && a.date >= from && a.date <= to) taken[a.date + '|' + a.slotId] = true;
  });
  var st = readSettings_(), hol = {}, lock = {};
  st.holidays.forEach(function (h) { hol[h] = true; });
  st.locks.forEach(function (l) { lock[l.date + '|' + l.slotId] = true; });
  var cb = calendarBlocks_(from, to);

  var days = [];
  for (var d = from, guard = 0; d <= to && guard < 400; d = addDays_(d, 1), guard++) {
    var day = { date: d, status: 'open', slots: [] };
    if (d < today || d > maxDate) day.status = 'past';
    else if (CONFIG.OPEN_WEEKDAYS.indexOf(dow_(d)) < 0 || hol[d] || cb.days[d]) day.status = 'closed';
    else {
      var anyOpen = false, anyTaken = false;
      CONFIG.SLOTS.forEach(function (sl) {
        var key = d + '|' + sl.id, reason = '';
        if (taken[key]) reason = 'booked';
        else if (lock[key] || cb.slots[key]) reason = 'locked';
        else if (dateAt_(d, sl.start).getTime() < nowMs + lead * 3600000) reason = 'late';
        if (!reason) anyOpen = true;
        if (reason === 'booked' || reason === 'locked') anyTaken = true;
        day.slots.push({ id: sl.id, label: sl.label, available: !reason, reason: reason });
      });
      if (!anyOpen) day.status = anyTaken ? 'full' : 'past';
    }
    days.push(day);
  }
  return days;
}

// ───────── 價格 ─────────
function findMain_(id) {
  for (var g = 0; g < CATALOG.main.length; g++)
    for (var i = 0; i < CATALOG.main[g].items.length; i++)
      if (CATALOG.main[g].items[i].id === id) return CATALOG.main[g].items[i];
  return null;
}
/** sel = { main, patch, extend, removal } → 金額與文字（金額一律由後端計算，不信任前端） */
function calcPrice_(sel) {
  sel = sel || {};
  var m = findMain_(sel.main);
  if (!m) throw new AppError('INVALID', '請選擇施作項目');
  var min = m.min, max = m.max, addons = [], fingers = 0;
  CATALOG.perFinger.forEach(function (p) {
    var n = Number(sel[p.id]) || 0;
    if (n !== Math.floor(n) || n < 0 || n > 10) throw new AppError('INVALID', p.name + '指數需為 0–10');
    if (n > 0) { min += n * p.price; max += n * p.price; addons.push(p.name + '×' + n + '指'); fingers += n; }
  });
  if (fingers > 10) throw new AppError('INVALID', '甲片與延甲合計最多 10 指');
  var rid = sel.removal || 'none', r = null;
  CATALOG.removal.forEach(function (x) { if (x.id === rid) r = x; });
  if (!r) throw new AppError('INVALID', '卸甲選項錯誤');
  if (r.price > 0) { min += r.price; max += r.price; addons.push(r.name); }
  return { main: m.name, addons: addons.join('、'), min: min, max: max };
}

// ───────── 預約 ─────────
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { throw new AppError('BUSY', '系統忙碌中，請稍後再試一次'); }
  try { return fn(); } finally { lock.releaseLock(); }
}
function assertSlotFree_(date, slotId, opts) {
  if (!isDateStr_(date)) throw new AppError('INVALID', '日期格式錯誤');
  var sl = slotById_(slotId);
  if (!sl) throw new AppError('INVALID', '時段錯誤');
  var day = availability_(date, date, opts)[0];
  var s = null;
  day.slots.forEach(function (x) { if (x.id === slotId) s = x; });
  if (day.status === 'closed') throw new AppError('CLOSED', '這一天不開放預約');
  if (!s || !s.available) {
    if (s && s.reason === 'late' || day.status === 'past') throw new AppError('LATE', '這個時段已超過可預約時間');
    throw new AppError('TAKEN', '這個時段剛剛被預約走了，請改選其他時段');
  }
  return sl;
}
function newId_(date, appts) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', used = {};
  appts.forEach(function (a) { used[a.id] = true; });
  for (var t = 0; t < 50; t++) {
    var id = 'LL' + date.substr(5, 2) + date.substr(8, 2) + '-';
    for (var i = 0; i < 3; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
    if (!used[id]) return id;
  }
  throw new AppError('ERROR', '無法產生訂單編號');
}
function cleanPhone_(p) {
  var s = String(p || '').replace(/[^\d]/g, '');
  if (!/^(09\d{8}|0[2-8]\d{7,8})$/.test(s)) throw new AppError('INVALID', '請輸入正確的電話號碼（例：0912345678）');
  return s;
}
function calendarAdd_(a) {
  var cal = cal_();
  if (!cal) return '';
  try {
    var sl = slotById_(a.slotId) || slotByLabel_(a.slot);
    var ev = cal.createEvent('💅 ' + a.name + '｜' + a.main, dateAt_(a.date, sl.start), dateAt_(a.date, sl.end), {
      description: '訂單 ' + a.id + '\n電話 ' + a.phone + '\n項目 ' + a.main + (a.addons ? '\n加購 ' + a.addons : '') +
        '\n預估 ' + priceText_(a.price, a.priceMax) + (a.note ? '\n備註 ' + a.note : '')
    });
    ev.setTag('lili', a.id);
    return ev.getId();
  } catch (e) { console.error('calendarAdd_ ' + e); return ''; }
}
function calendarRemove_(eventId) {
  if (!eventId) return;
  try { var cal = cal_(); var ev = cal && cal.getEventById(eventId); if (ev) ev.deleteEvent(); }
  catch (e) { console.error('calendarRemove_ ' + e); }
}

/**
 * 建立預約。user = { uid, name, isOwner }；input.admin=true 代表店長手動新增
 */
function createBooking_(input, user) {
  var admin = !!(input.admin && user.isOwner);
  var name = String(input.name || '').trim().substr(0, 30);
  if (!name) throw new AppError('INVALID', '請輸入姓名');
  var phone = cleanPhone_(input.phone);
  var note = String(input.note || '').trim().substr(0, 200);
  if (!admin && !input.consent) throw new AppError('INVALID', '請勾選同意個資使用說明');
  var price = calcPrice_(input.sel);

  return withLock_(function () {
    var appts = readAppts_();
    var today = todayStr_();
    if (!admin) {
      var mine = appts.filter(function (a) { return a.uid === user.uid && isActive_(a) && a.date >= today; });
      if (mine.length >= CONFIG.MAX_ACTIVE_PER_USER)
        throw new AppError('LIMIT', '您目前已有 ' + mine.length + ' 筆預約，請先完成或取消後再預約');
    }
    var custom = input.slotId === 'CUSTOM';
    var sl = custom ? assertCustomOk_(input.date, input.customTime, admin)
      : assertSlotFree_(input.date, input.slotId, { leadHours: admin ? 0 : null }); // 鎖內再檢查一次，防止重複預約
    var a = {
      id: newId_(input.date, appts), date: input.date, slotId: sl.id, slot: sl.label,
      name: name, phone: phone, uid: admin ? '' : user.uid, main: price.main, addons: price.addons,
      price: price.min, priceMax: price.max, status: custom && !admin ? STATUS.PENDING : STATUS.BOOKED,
      note: note + (admin ? '（店長新增）' : '')
    };
    var sh = sheet_('Appointments');
    var row = Math.max(sh.getLastRow(), 1) + 1;
    var vals = [];
    for (var i = 0; i < HEADERS.length; i++) vals.push('');
    vals[COL.id - 1] = a.id; vals[COL.date - 1] = a.date; vals[COL.slot - 1] = a.slot;
    vals[COL.name - 1] = a.name; vals[COL.phone - 1] = a.phone; vals[COL.uid - 1] = a.uid;
    vals[COL.main - 1] = a.main; vals[COL.addons - 1] = a.addons; vals[COL.price - 1] = a.price;
    vals[COL.remindDate - 1] = addDays_(a.date, CONFIG.REVISIT_DAYS);
    vals[COL.status - 1] = a.status; vals[COL.created - 1] = fmt_(NOW_(), 'yyyy-MM-dd HH:mm');
    vals[COL.priceMax - 1] = a.priceMax; vals[COL.note - 1] = a.note;
    var rng = sh.getRange(row, 1, 1, HEADERS.length);
    rng.setNumberFormat('@'); // 純文字，避免日期被轉型、電話開頭 0 消失
    sh.getRange(row, COL.price).setNumberFormat('0');
    sh.getRange(row, COL.priceMax).setNumberFormat('0');
    rng.setValues([vals]);
    a.row = row;
    if (isPending_(a)) {
      notifyOwnerEmail_('待確認（自填時間） ' + dateLabel_(a.date) + ' ' + a.slot, a);
      notifyOwnerPending_(a);
      return a;
    }
    a.eventId = calendarAdd_(a);
    if (a.eventId) setCell_(row, COL.eventId, a.eventId);
    notifyOwnerEmail_('新預約 ' + dateLabel_(a.date) + ' ' + a.slot, a);
    return a;
  });
}

/** 自填時間：只檢查日期與提前時間，不檢查固定場次（由店長確認） */
function assertCustomOk_(date, hm, admin) {
  if (!isDateStr_(date)) throw new AppError('INVALID', '日期格式錯誤');
  var sl = customSlot_(hm), today = todayStr_();
  if (date < today || date > addDays_(today, CONFIG.MAX_ADVANCE_DAYS)) throw new AppError('LATE', '這一天無法預約');
  var lead = admin ? 0 : CONFIG.MIN_LEAD_HOURS;
  if (dateAt_(date, sl.start).getTime() < NOW_().getTime() + lead * 3600000) throw new AppError('LATE', '這個時間已超過可預約時間');
  return sl;
}

/** 店長確認自填時間的預約 → 成立、寫入日曆、通知客人（1 則推播） */
function confirmPending_(id) {
  return withLock_(function () {
    var a = findBooking_(String(id || '').trim().toUpperCase());
    if (!a) throw new AppError('NOT_FOUND', '找不到這筆預約');
    if (!isPending_(a)) throw new AppError('INVALID', '這筆預約不是待確認狀態（目前：' + a.status + '）');
    setCell_(a.row, COL.status, STATUS.BOOKED);
    a.status = STATUS.BOOKED;
    a.eventId = calendarAdd_(a);
    if (a.eventId) setCell_(a.row, COL.eventId, a.eventId);
    if (a.uid) pushMessage_(a.uid, [confirmFlex_(a, 'new')]);
    return a;
  });
}

/** 有自填時間的預約時推播給店長（每筆 1 則；不常發生） */
function notifyOwnerPending_(a) {
  var owner = prop_('OWNER_UID');
  if (!owner) return;
  try {
    pushMessage_(owner, [{ type: 'text', text: '🔔 有一筆自填時間的預約待確認\n' + dateLabel_(a.date) + ' ' + a.slot + '\n' + a.name + '　' + a.phone +
      '\n' + a.main + (a.addons ? '＋' + a.addons : '') + (a.note ? '\n備註：' + a.note : '') +
      '\n\n可以接 → 回覆「確認 ' + a.id + '」\n不行 → 回覆「取消 ' + a.id + '」，再私訊客人另約時間' }]);
  } catch (e) { console.error('notifyOwnerPending_ ' + e); }
}

function findBooking_(id) {
  var list = readAppts_();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}
function ownBooking_(id, user) {
  var a = findBooking_(String(id || '').trim().toUpperCase());
  if (!a || (!user.isOwner && a.uid !== user.uid)) throw new AppError('NOT_FOUND', '找不到這筆預約');
  return a;
}

function cancelBooking_(id, user) {
  return withLock_(function () {
    var a = ownBooking_(id, user);
    if (a.status === STATUS.CANCELLED) return a;
    if (a.date < todayStr_()) throw new AppError('INVALID', '這筆預約已經過期');
    setCell_(a.row, COL.status, STATUS.CANCELLED);
    setCell_(a.row, COL.cancelledAt, fmt_(NOW_(), 'yyyy-MM-dd HH:mm'));
    calendarRemove_(a.eventId);
    setCell_(a.row, COL.eventId, '');
    a.status = STATUS.CANCELLED;
    notifyOwnerEmail_('取消預約 ' + dateLabel_(a.date) + ' ' + a.slot, a);
    return a;
  });
}

function rescheduleBooking_(id, date, slotId, user) {
  return withLock_(function () {
    var a = ownBooking_(id, user);
    if (a.status !== STATUS.BOOKED || a.date < todayStr_()) throw new AppError('INVALID', '這筆預約無法改期');
    var sl = assertSlotFree_(date, slotId, { leadHours: user.isOwner ? 0 : null, excludeId: a.id });
    var old = dateLabel_(a.date) + ' ' + a.slot;
    var sh = sheet_('Appointments');
    sh.getRange(a.row, COL.date).setNumberFormat('@').setValue(date);
    sh.getRange(a.row, COL.slot).setNumberFormat('@').setValue(sl.label);
    sh.getRange(a.row, COL.remindDate).setNumberFormat('@').setValue(addDays_(date, CONFIG.REVISIT_DAYS));
    setCell_(a.row, COL.remindStatus, '');
    setCell_(a.row, COL.tomorrowStatus, '');
    calendarRemove_(a.eventId);
    a.date = date; a.slotId = sl.id; a.slot = sl.label;
    a.eventId = calendarAdd_(a);
    setCell_(a.row, COL.eventId, a.eventId);
    notifyOwnerEmail_('改期 ' + old + ' → ' + dateLabel_(a.date) + ' ' + a.slot, a);
    return a;
  });
}

/** 某位客人今天以後、未取消的預約（依日期排序） */
function upcomingOf_(uid) {
  var today = todayStr_();
  return readAppts_().filter(function (a) { return uid && a.uid === uid && isActive_(a) && a.date >= today; })
    .sort(function (a, b) { return (a.date + a.slot) < (b.date + b.slot) ? -1 : 1; });
}

// ───────── 店長：公休／鎖時段 ─────────
function listLocks_() {
  var st = readSettings_(), today = todayStr_();
  return {
    holidays: st.holidays.filter(function (h) { return h >= today; }).sort().map(function (h) { return { date: h, dateLabel: dateLabel_(h) }; }),
    locks: st.locks.filter(function (l) { return l.date >= today; }).map(function (l) { return { date: l.date, dateLabel: dateLabel_(l.date), slotId: l.slotId, slot: l.slot, note: l.note }; })
  };
}
/** slotId 傳 'ALL' 代表整天公休 */
function addLock_(date, slotId, note) {
  if (!isDateStr_(date)) throw new AppError('INVALID', '日期格式錯誤');
  return withLock_(function () {
    var st = readSettings_();
    var booked = readAppts_().filter(function (a) { return isActive_(a) && a.date === date && (slotId === 'ALL' || a.slotId === slotId); });
    if (booked.length) throw new AppError('TAKEN', '這個時段已有預約（' + booked.map(function (a) { return a.slot + ' ' + a.name; }).join('、') + '），請先取消或改期');
    if (slotId === 'ALL') { if (st.holidays.indexOf(date) < 0) st.holidays.push(date); }
    else {
      var sl = slotById_(slotId);
      if (!sl) throw new AppError('INVALID', '時段錯誤');
      if (!st.locks.some(function (l) { return l.date === date && l.slotId === slotId; }))
        st.locks.push({ date: date, slotId: sl.id, slot: sl.label, note: String(note || '').substr(0, 50) });
    }
    writeSettings_(st.holidays, st.locks);
    return listLocks_();
  });
}
function removeLock_(date, slotId) {
  return withLock_(function () {
    var st = readSettings_();
    if (slotId === 'ALL') st.holidays = st.holidays.filter(function (h) { return h !== date; });
    else st.locks = st.locks.filter(function (l) { return !(l.date === date && l.slotId === slotId); });
    writeSettings_(st.holidays, st.locks);
    return listLocks_();
  });
}

/** 新預約／取消／改期時寄信給店長（有設定 OWNER_EMAIL 才寄；不佔 LINE 推播額度） */
function notifyOwnerEmail_(subject, a) {
  var to = prop_('OWNER_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to, '【Li麗預約】' + subject,
      '訂單 ' + a.id + '\n日期 ' + dateLabel_(a.date) + ' ' + a.slot + '\n顧客 ' + a.name + ' ' + a.phone +
      '\n項目 ' + a.main + (a.addons ? '\n加購 ' + a.addons : '') + '\n預估 ' + priceText_(a.price, a.priceMax) +
      (a.note ? '\n備註 ' + a.note : ''));
  } catch (e) { console.error('notifyOwnerEmail_ ' + e); }
}
