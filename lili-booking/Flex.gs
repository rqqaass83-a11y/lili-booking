/**
 * Flex Message 卡片
 * 注意：LINE 不支援自訂字體、陰影與裝飾圖形，這裡以 Figma 稿的配色與資訊層級為準，頁首一律滿版赤陶色。
 */
var C = { bg: '#FBF9F7', primary: '#D87D56', text: '#2B2523', line: '#E8DFD8', muted: '#7A6D66', white: '#FFFFFF' };

function fxText_(text, o) {
  var t = { type: 'text', text: String(text == null || text === '' ? '—' : text), color: C.text, size: 'md', wrap: true };
  for (var k in (o || {})) t[k] = o[k];
  return t;
}
function fxKv_(label, value, o) {
  var v = { weight: 'bold', flex: 5 };
  for (var k in (o || {})) v[k] = o[k];
  return { type: 'box', layout: 'horizontal', spacing: 'md', contents: [
    fxText_(label, { color: C.muted, size: 'sm', flex: 2, wrap: false }), fxText_(value, v)
  ] };
}
function fxSep_() { return { type: 'separator', color: C.line, margin: 'lg' }; }
function fxBtn_(label, action, primary) {
  action.label = label;
  var b = { type: 'button', height: 'sm', action: action, style: primary ? 'primary' : 'secondary' };
  if (primary) b.color = C.primary;
  return b;
}
function fxUri_(uri) { return { type: 'uri', uri: uri }; }
function fxPost_(data, displayText) { return { type: 'postback', data: data, displayText: displayText }; }

/** 卡片頁首圖（Figma 風格明體標題，放在 GitHub Pages 的 cards/ 資料夾） */
var CARD_HERO_ = { confirm: 1, reschedule: 1, pending: 1, remind: 1, care: 1, slots: 1, mine: 1, cancel: 1, owner: 1 };
var CARD_DYN_SUB_ = { remind: 1, care: 1, mine: 1, owner: 1 }; // 這些卡片的副標是動態的（日期等），用圖時改放到內文第一行

function fxBubble_(title, subtitle, body, footer, key) {
  var useHero = key && CARD_HERO_[key] && CONFIG.PUBLIC_BASE;
  var b = { type: 'bubble', size: 'mega',
    body: { type: 'box', layout: 'vertical', backgroundColor: C.bg, paddingAll: '20px', spacing: 'md', contents: body } };
  if (useHero) {
    b.hero = { type: 'image', url: CONFIG.PUBLIC_BASE + 'cards/' + key + '.jpg', size: 'full', aspectRatio: '2:1', aspectMode: 'cover' };
    if (subtitle && CARD_DYN_SUB_[key]) body.unshift(fxText_(subtitle, { color: C.primary, weight: 'bold', size: 'sm' }));
  } else {
    var head = [fxText_(CONFIG.STUDIO_NAME, { color: C.white, size: 'sm', wrap: false }),
      fxText_(title, { color: C.white, size: 'xl', weight: 'bold' })];
    if (subtitle) head.push(fxText_(subtitle, { color: C.white, size: 'sm' }));
    b.header = { type: 'box', layout: 'vertical', backgroundColor: C.primary, paddingAll: '20px', spacing: 'xs', contents: head };
  }
  if (footer && footer.length) b.footer = { type: 'box', layout: 'vertical', backgroundColor: C.bg, paddingAll: '16px', spacing: 'sm', contents: footer };
  return b;
}
function fxMsg_(alt, contents) { return { type: 'flex', altText: String(alt).substr(0, 380), contents: contents }; }

function bookingRows_(a, withId) {
  var rows = [];
  if (withId) rows.push(fxKv_('訂單編號', a.id, { weight: 'regular' }));
  rows.push(fxKv_('日期', dateLabel_(a.date)), fxKv_('時段', a.slot), fxKv_('項目', a.main));
  if (a.addons) rows.push(fxKv_('加購', a.addons, { weight: 'regular' }));
  rows.push(fxKv_('預估金額', priceText_(a.price, a.priceMax), { color: C.primary }));
  return rows;
}
function manageButtons_(a) {
  return [{ type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
    fxBtn_('改期', fxUri_(liffUrl_('mode=reschedule&id=' + a.id))),
    fxBtn_('取消預約', fxPost_('act=cancel&id=' + a.id, '我想取消 ' + dateLabel_(a.date) + ' 的預約'))
  ] }];
}

/** 預約成功／改期成功確認單 */
function confirmFlex_(a, kind) {
  var title = kind === 'reschedule' ? '改期成功' : '預約成功';
  var body = bookingRows_(a, true).concat([fxSep_(),
    fxText_('・本店為全預約制，僅接受預約來店\n・延甲或特殊需求請提前告知\n・參考圖可以直接傳到這個聊天室', { size: 'sm', color: C.muted, margin: 'lg' })]);
  return fxMsg_(title + '｜' + dateLabel_(a.date) + ' ' + a.slot, fxBubble_(title, '已為您保留時段，期待您的光臨', body, manageButtons_(a), kind === 'reschedule' ? 'reschedule' : 'confirm'));
}

/** 自填時間：已收到申請、待店長確認 */
function pendingFlex_(a) {
  var body = bookingRows_(a, true).concat([fxSep_(),
    fxText_('這個時間不在固定場次內，美甲師確認後會再通知您。若時間不方便，我們會在這個聊天室跟您另約時段。', { size: 'sm', color: C.muted, margin: 'lg' })]);
  return fxMsg_('已收到預約申請（待確認）｜' + dateLabel_(a.date) + ' ' + a.slot, fxBubble_('已收到預約申請', '待美甲師確認', body,
    [fxBtn_('取消申請', fxPost_('act=cancel&id=' + a.id, '我想取消 ' + dateLabel_(a.date) + ' 的預約申請'))], 'pending'));
}

/** 明日預約提醒（客人） */
function remindFlex_(a) {
  var body = bookingRows_(a, false).concat([fxSep_(),
    fxText_('若臨時無法前來，請點下方按鈕或直接回覆訊息告訴我們。', { size: 'sm', color: C.muted, margin: 'lg' })]);
  return fxMsg_('明日預約提醒｜' + dateLabel_(a.date) + ' ' + a.slot, fxBubble_('明日預約提醒', dateLabel_(a.date) + ' ' + a.slot, body, manageButtons_(a), 'remind'));
}

/** 25 天回訪關懷 */
function careFlex_(a) {
  var body = [
    fxText_('親愛的 ' + (a.name || '') + ' 妳好：\n距離上次來訪已經 ' + CONFIG.REVISIT_DAYS + ' 天囉！目前的指甲還漂亮嗎？'),
    { type: 'box', layout: 'vertical', backgroundColor: '#F6ECE5', cornerRadius: '12px', paddingAll: '14px', spacing: 'sm', contents: [
      fxText_('💡 美甲師小叮嚀', { weight: 'bold', color: C.primary, size: 'sm' }),
      fxText_('真甲長長後，受力重心會前移，日常碰撞容易造成甲面掀起或原生指甲折斷。建議在 25–28 天內回店卸甲或換新造型，保護甲床健康。', { size: 'sm', color: C.text })
    ] },
    fxKv_('上次施作', dateLabel_(a.date) + '　' + a.main, { weight: 'regular', size: 'sm' })
  ];
  return fxMsg_('卸甲回訪關懷｜該幫指甲保養囉', fxBubble_('卸甲回訪關懷', '上次施作：' + dateLabel_(a.date), body,
    [fxBtn_('預約下次時段', fxUri_(liffUrl_()), true)], 'care'));
}

/** 營業時間與即時空檔 */
function slotsFlex_() {
  var today = todayStr_();
  var days = availability_(today, addDays_(today, 21)).filter(function (d) { return d.status === 'open' || d.status === 'full'; }).slice(0, 7);
  var body = [fxKv_('營業時間', CONFIG.HOURS_TEXT, { weight: 'regular', size: 'sm' }),
    fxKv_('每日場次', CONFIG.SLOTS.map(function (s) { return s.label; }).join('\n'), { weight: 'regular', size: 'sm' }),
    fxSep_(), fxText_('近期空檔', { weight: 'bold', margin: 'lg' })];
  if (!days.length) body.push(fxText_('近期時段已滿，請點下方按鈕查看更多日期。', { size: 'sm', color: C.muted }));
  days.forEach(function (d) {
    var free = d.slots.filter(function (s) { return s.available; });
    body.push({ type: 'box', layout: 'horizontal', spacing: 'md', contents: [
      fxText_(dateLabel_(d.date), { flex: 3, wrap: false }),
      fxText_(free.length ? free.map(function (s) { return s.label.substr(0, 5); }).join('・') : '已額滿',
        { flex: 5, align: 'end', size: 'sm', weight: free.length ? 'bold' : 'regular', color: free.length ? C.primary : C.muted, wrap: false })
    ] });
  });
  body.push(fxText_('本店為全預約制，僅接受預約來店。', { size: 'xs', color: C.muted, margin: 'lg' }));
  var footer = [fxBtn_('線上即時預約', fxUri_(liffUrl_()), true)];
  return fxMsg_('營業時間與即時空檔', fxBubble_('營業時間與即時空檔', '僅接受預約來店', body, footer, 'slots'));
}

/** 預約查詢：列出客人未到的預約（最多 5 筆） */
function bookingsFlex_(list) {
  if (!list.length) {
    return fxMsg_('目前沒有預約', fxBubble_('預約查詢', '', [fxText_('目前沒有進行中的預約。')],
      [fxBtn_('線上即時預約', fxUri_(liffUrl_()), true)]));
  }
  var bubbles = list.slice(0, 5).map(function (a) {
    return fxBubble_('我的預約', dateLabel_(a.date) + ' ' + a.slot, bookingRows_(a, true), manageButtons_(a), 'mine');
  });
  return fxMsg_('您有 ' + list.length + ' 筆預約', bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles });
}

/** 取消前再確認一次 */
function cancelAskFlex_(a) {
  return fxMsg_('確定要取消預約嗎？', fxBubble_('確定要取消嗎？', '', bookingRows_(a, true), [
    fxBtn_('確定取消', fxPost_('act=cancel_yes&id=' + a.id, '確定取消'), true),
    fxBtn_('保留預約', fxPost_('act=keep', '保留預約'))
  ], 'cancel'));
}

/** 店長：某一天的行程（今日預約／明日行程總覽） */
function dayFlex_(date, title) {
  var list = dayAppts_(date), body = [], min = 0, max = 0;
  CONFIG.SLOTS.forEach(function (sl, i) {
    var a = list.filter(function (x) { return x.slotId === sl.id; })[0];
    if (i) body.push(fxSep_());
    var col = [fxText_(a ? a.name + '　' + a.phone : '空檔', { weight: a ? 'bold' : 'regular', color: a ? C.text : C.muted })];
    if (a) {
      min += a.price; max += a.priceMax;
      col.push(fxText_(a.main + (a.addons ? '＋' + a.addons : ''), { size: 'sm' }));
      col.push(fxText_(priceText_(a.price, a.priceMax) + (a.note ? '｜' + a.note : ''), { size: 'sm', color: C.muted }));
    }
    body.push({ type: 'box', layout: 'horizontal', spacing: 'md', margin: i ? 'lg' : 'none', contents: [
      fxText_(sl.start, { flex: 2, weight: 'bold', color: C.primary, wrap: false }),
      { type: 'box', layout: 'vertical', flex: 7, spacing: 'xs', contents: col }
    ] });
  });
  list.filter(function (x) { return x.slotId === 'CUSTOM'; }).forEach(function (a) {
    min += a.price; max += a.priceMax;
    body.push(fxSep_());
    body.push({ type: 'box', layout: 'horizontal', spacing: 'md', margin: 'lg', contents: [
      fxText_(a.slot.substr(0, 5), { flex: 2, weight: 'bold', color: C.primary, wrap: false }),
      { type: 'box', layout: 'vertical', flex: 7, spacing: 'xs', contents: [
        fxText_(a.name + '　' + a.phone + (isPending_(a) ? '（待確認）' : ''), { weight: 'bold' }),
        fxText_(a.main + (a.addons ? '＋' + a.addons : ''), { size: 'sm' }),
        fxText_(priceText_(a.price, a.priceMax) + (a.note ? '｜' + a.note : ''), { size: 'sm', color: C.muted })
      ] }
    ] });
  });
  var sub = dateLabel_(date) + '　共 ' + list.length + ' 位' + (list.length ? '｜預估 ' + priceText_(min, max) : '');
  return fxMsg_(title + '｜' + sub, fxBubble_(title, sub, body, [], 'owner'));
}
