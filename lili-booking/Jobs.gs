/**
 * 定時工作（由 installTriggers() 建立的觸發條件呼叫）
 */

/** 每天早上：標記已完成、明日提醒、25 天回訪關懷 */
function dailyMorningJob() {
  markCompleted_();
  var r1 = sendTomorrowReminders_();
  var r2 = sendCareReminders_();
  console.log('明日提醒 ' + r1 + ' 則；回訪關懷 ' + r2 + ' 則');
}

/** 每天晚上：推播明日行程給店長（明天沒有預約就不發） */
function ownerEveningJob() {
  if (!CONFIG.OWNER_DAILY_PUSH) return;
  var owner = prop_('OWNER_UID');
  var tomorrow = addDays_(todayStr_(), 1);
  if (!owner || !dayAppts_(tomorrow).length) return;
  pushMessage_(owner, [dayFlex_(tomorrow, '明日行程總覽')]);
}

function markCompleted_() {
  var today = todayStr_();
  readAppts_().forEach(function (a) {
    if (a.status === STATUS.BOOKED && a.date < today) setCell_(a.row, COL.status, STATUS.DONE);
  });
}

function sendTomorrowReminders_() {
  var tomorrow = addDays_(todayStr_(), 1), n = 0;
  readAppts_().forEach(function (a) {
    if (a.status !== STATUS.BOOKED || a.date !== tomorrow || a.tomorrowStatus) return;
    if (!a.uid) { setCell_(a.row, COL.tomorrowStatus, '無 LINE，請電話提醒'); return; }
    var r = pushMessage_(a.uid, [remindFlex_(a)]);
    setCell_(a.row, COL.tomorrowStatus, r.ok ? '已發送 ' + fmt_(NOW_(), 'MM-dd HH:mm') : (r.quota ? '額度不足未發' : '發送失敗 ' + r.code));
    if (r.ok) n++;
  });
  return n;
}

/**
 * 25 天回訪關懷：只發給「最近一次施作已滿 25 天、而且之後沒有再預約」的客人
 */
function sendCareReminders_() {
  var today = todayStr_(), all = readAppts_().filter(function (x) { return isActive_(x) && !isPending_(x); }), n = 0;
  var floor = addDays_(today, -7); // 只補發最近 7 天內到期的，避免一次發出舊名單
  all.forEach(function (a) {
    if (a.remindStatus || !a.remindDate || a.remindDate > today || a.date >= today) return;
    if (!a.uid) { setCell_(a.row, COL.remindStatus, '無 LINE'); return; }
    var newer = all.some(function (x) { return x.uid === a.uid && x.row !== a.row && x.date > a.date; });
    if (newer) { setCell_(a.row, COL.remindStatus, '已再預約，略過'); return; }
    if (a.remindDate < floor) { setCell_(a.row, COL.remindStatus, '逾期未發'); return; }
    var r = pushMessage_(a.uid, [careFlex_(a)]);
    setCell_(a.row, COL.remindStatus, r.ok ? '已發送 ' + fmt_(NOW_(), 'MM-dd HH:mm') : (r.quota ? '額度不足未發' : '發送失敗 ' + r.code));
    if (r.ok) n++;
  });
  return n;
}
