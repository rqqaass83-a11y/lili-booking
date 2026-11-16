/**
 * LiLi 美甲預約系統 — 設定檔
 * 營運規則、價目都集中在這裡，改這個檔案就會同時影響預約頁、卡片和試算表。
 * 金鑰類（Token 等）不放在這裡，放在「專案設定 → 指令碼屬性」，見 部署手冊。
 */
var CONFIG = {
  TZ: 'Asia/Taipei',
  STUDIO_NAME: '@Li麗 Nail Studio',
  // 預約頁與圖片放在 GitHub Pages（price.png、menu_customer.png、menu_owner.png）
  PUBLIC_BASE: 'https://rqqaass83-a11y.github.io/lili-booking/lili-booking/',

  // 營業日：1=週一 … 5=週五（0=週日、6=週六）
  OPEN_WEEKDAYS: [1, 2, 3, 4, 5],
  HOURS_TEXT: '週一至週五 10:00–18:00（週六、週日公休）',

  // 每日固定 3 場（每場約 2 小時，2026-11-16 業主調整）
  SLOTS: [
    { id: 'S1', label: '10:00-12:00', start: '10:00', end: '12:00' },
    { id: 'S2', label: '13:30-15:30', start: '13:30', end: '15:30' },
    { id: 'S3', label: '16:00-18:00', start: '16:00', end: '18:00' }
  ],

  // 自填時間：客人可在三個固定場次以外填希望的開始時間，送出後為「待確認」，由店長確認
  CUSTOM_SLOT: { enabled: true, earliest: '08:00', latest: '20:00', minutes: 120 },

  MAX_ADVANCE_DAYS: 60,     // 最遠可預約幾天後（待業主確認）
  MIN_LEAD_HOURS: 12,       // 最晚要在開始前幾小時預約（待業主確認；店長手動新增不受限）
  MAX_ACTIVE_PER_USER: 2,   // 每位客人同時最多幾筆未到的預約（不收訂金，避免佔位）
  REVISIT_DAYS: 25,         // 施作後第幾天發回訪關懷
  ALLDAY_EVENT_BLOCKS_DAY: true, // 日曆上的「整天」活動視為公休

  PUSH_MONTHLY_LIMIT: 190,  // 免費方案每月 200 則，留 10 則緩衝
  OWNER_DAILY_PUSH: true,   // 每晚推播「明日行程總覽」給店長（每月約 22 則）
  REMINDER_HOUR: 10,        // 每天幾點發「明日提醒」「25 天關懷」
  OWNER_SUMMARY_HOUR: 20,   // 每天幾點發店長的明日行程

  NOTICES: [
    '本店為全預約制，僅接受預約來店。',
    '全項目皆含基礎指緣護理（消毒→修型→甘皮→去油→指緣油）。',
    '延甲需提前告知，請在預約時選擇指數或於備註說明。',
    '設計款依實際內容報價，金額以現場為準。',
    '如需取消或改期，請點「預約查詢」操作，或直接傳訊息給我們。',
    '建議每 25–28 天卸甲保養。'
  ],
  PRIVACY_TEXT: '我同意 @Li麗 Nail Studio 蒐集我的姓名、電話與 LINE 帳號識別碼，僅用於本次預約的聯繫與提醒。'
};

/**
 * 價目（以價目表為準；名稱只在這裡定義一次）
 * min/max 相同＝固定價；不同＝價格區間。
 */
var CATALOG = {
  main: [
    { group: '凝膠美甲', items: [
      { id: 'solid',    name: '基礎單色', min: 700,  max: 700 },
      { id: 'twotone',  name: '跳色美甲', min: 800,  max: 800 },
      { id: 'cateye',   name: '晶石貓眼', min: 900,  max: 900 },
      { id: 'gradient', name: '漸層凝膠', min: 1100, max: 1100 },
      { id: 'french',   name: '經典法式', min: 1200, max: 1200 }
    ] },
    { group: '設計款', items: [
      { id: 'design', name: '獨家設計款／造型彩繪／立體排鑽', min: 1100, max: 1300 }
    ] }
  ],
  perFinger: [
    { id: 'patch',  name: '半貼無痕甲片', price: 80 },
    { id: 'extend', name: '凝膠延甲', price: 100 }
  ],
  // 卸甲只能擇一（2026-11-16 業主確認價格）
  removal: [
    { id: 'none',        name: '不需卸甲', price: 0 },
    { id: 'remove_in',   name: '本店卸甲', price: 150 },
    { id: 'remove_out',  name: '他店卸甲', price: 250 },
    { id: 'remove_basic', name: '純卸甲＋基礎保養', price: 500 }
  ]
};

/** 試算表 Appointments 欄位（A–K 與原規劃相同，L 之後為系統新增） */
var COL = {
  id: 1, date: 2, slot: 3, name: 4, phone: 5, uid: 6, main: 7, addons: 8, price: 9,
  remindDate: 10, remindStatus: 11, status: 12, created: 13, eventId: 14,
  tomorrowStatus: 15, cancelledAt: 16, priceMax: 17, note: 18
};
var HEADERS = ['訂單編號', '預約日期', '預約時段', '顧客姓名', '聯絡電話', 'LINE_UID', '施作項目', '加購項目',
  '預估金額', '預計提醒日', '提醒發送狀態', '狀態', '建立時間', '日曆事件ID', '明日提醒狀態', '取消時間', '預估金額上限', '備註'];
var STATUS = { BOOKED: '已預約', PENDING: '待確認', CANCELLED: '已取消', DONE: '已完成' };

function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key) || ''; }
function setProp_(key, val) { PropertiesService.getScriptProperties().setProperty(key, String(val)); }
