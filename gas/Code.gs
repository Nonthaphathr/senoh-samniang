/**
 * เสนาะสำเนียง By ครูนนท์ — ตัวกลางไฟล์ (Google Drive) + AI ฟังอักขรวิธี (Gemini)
 * PLAN ข้อ 5
 *
 * ติดตั้ง (ทำครั้งเดียว ด้วยบัญชี nonthaphathr@gmail.com):
 *   1) script.google.com → โปรเจกต์ใหม่ → วางไฟล์นี้ทั้งไฟล์
 *   2) Project Settings → Script Properties ใส่
 *        GEMINI_API_KEY = คีย์จาก aistudio.google.com     (ไม่ใส่ = ปิดฟีเจอร์ AI)  ← ครูวางเอง
 *        GEMINI_MODEL   = gemini-3.5-flash                 (ไม่บังคับ)
 *        TEACHERS       = อีเมลครูคั่นด้วยจุลภาค           (ไม่บังคับ ค่าเริ่มต้น nonthaphathr@gmail.com)
 *   3) เลือกฟังก์ชัน setup → Run (อนุญาตสิทธิ์ Drive) → ได้โฟลเดอร์ "เสนาะสำเนียง (ข้อมูลระบบ)"
 *   4) Deploy → New deployment → Web app : Execute as = Me, Who has access = Anyone → คัดลอก URL ใส่ GAS_URL ใน js/config.js
 *   ทุกครั้งที่แก้โค้ด: Deploy → Manage deployments → แก้ไข → Version: New version (URL เดิม)
 */

// ค่าสาธารณะ (apiKey ของ Firebase web เป็นค่าเปิดเผยได้ ความปลอดภัยอยู่ที่ rules) — ใช้เมื่อไม่ได้ตั้ง Script Properties
var DEFAULT_FB_API_KEY = 'AIzaSyAGJXUasNcHLDsAHqRaYrYLLKxm_Hq6TY8';
var DEFAULT_TEACHERS = 'nonthaphathr@gmail.com';

var MAX_REF_BYTES = 5 * 1024 * 1024;
var MAX_ATTEMPT_BYTES = 3 * 1024 * 1024;

function setup() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('ROOT_FOLDER_ID');
  var root = null;
  if (id) { try { root = DriveApp.getFolderById(id); } catch (e) { root = null; } }
  if (!root) { root = DriveApp.createFolder('เสนาะสำเนียง (ข้อมูลระบบ)'); p.setProperty('ROOT_FOLDER_ID', root.getId()); }
  sub_(root, 'ต้นแบบ'); sub_(root, 'นักเรียน');
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });   // ขอสิทธิ์ UrlFetch ตอนติดตั้ง
  Logger.log('ROOT_FOLDER_ID = ' + root.getId());
}

function doGet() { return json_({ ok: true, app: 'senoh-gas', t: Date.now() }); }

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents || '{}');
    if (req.action === 'ping') return json_({ ok: true, pong: Date.now() });
    var who = verify_(req.idToken);
    var A = ACTIONS[req.action];
    if (!A) throw new Error('unknown action');
    if (A.teacher && !who.teacher) throw new Error('forbidden');
    return json_(Object.assign({ ok: true }, A.fn(req, who)));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

var ACTIONS = {
  /* ครูอัปโหลดเสียงต้นแบบ */
  uploadRef: { teacher: true, fn: function (r) {
    var bytes = Utilities.base64Decode(r.data);
    if (bytes.length > MAX_REF_BYTES) throw new Error('ref too large');
    var f = sub_(root_(), 'ต้นแบบ').createFile(Utilities.newBlob(bytes, r.mime || 'audio/mpeg', safe_(r.name || 'ref') + ext_(r.mime)));
    f.setDescription(JSON.stringify({ kind: 'ref', poemId: r.poemId || '' }));
    return { fileId: f.getId(), bytes: bytes.length };
  } },

  /* ดึงไฟล์เสียง: ต้นแบบ = ทุกคนที่ล็อกอิน, เสียงนักเรียน = ครูหรือเจ้าของ */
  getAudio: { teacher: false, fn: function (r, who) {
    var f = DriveApp.getFileById(r.fileId), d = meta_(f);
    if (!inRoot_(f)) throw new Error('forbidden');
    if (d.kind !== 'ref' && !who.teacher && d.uid !== who.uid) throw new Error('forbidden');
    var b = f.getBlob();
    return { mime: b.getContentType(), data: Utilities.base64Encode(b.getBytes()) };
  } },

  /* นักเรียนอัปโหลดเสียงที่อ่าน → นักเรียน/{poemId}/{ห้อง}/ */
  uploadAttempt: { teacher: false, fn: function (r, who) {
    var bytes = Utilities.base64Decode(r.data);
    if (bytes.length > MAX_ATTEMPT_BYTES) throw new Error('attempt too large');
    var dir = sub_(sub_(sub_(root_(), 'นักเรียน'), safe_(r.poemId || 'ไม่ระบุบท')), safe_(r.room || 'ไม่ระบุห้อง'));
    var name = safe_((r.name || 'ไม่ระบุชื่อ') + '_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMMdd-HHmmss')) + ext_(r.mime);
    var f = dir.createFile(Utilities.newBlob(bytes, r.mime || 'audio/webm', name));
    f.setDescription(JSON.stringify({ kind: 'attempt', uid: who.uid, attemptId: r.attemptId || '', poemId: r.poemId || '', room: r.room || '' }));
    return { fileId: f.getId(), bytes: bytes.length };
  } },

  /* AI ฟังอักขรวิธี — ผลเป็น "ข้อสังเกต" ให้ครูยืนยันเสมอ */
  aiListen: { teacher: true, fn: function (r) {
    var p = PropertiesService.getScriptProperties(), key = p.getProperty('GEMINI_API_KEY');
    if (!key) throw new Error('ai-disabled');
    var model = p.getProperty('GEMINI_MODEL') || 'gemini-3.5-flash';
    var f = DriveApp.getFileById(r.fileId); if (!inRoot_(f)) throw new Error('forbidden');
    var b = f.getBlob();
    var units = (r.units || []).map(function (u, i) { return (i + 1) + '. ' + u; }).join('\n');
    var prompt = [
      'คุณเป็นผู้ช่วยครูภาษาไทย ฟังเสียงนักเรียนอ่านบทร้อยกรองเป็นทำนองเสนาะ (มีการเอื้อนและลากเสียง ซึ่งไม่ถือว่าผิด)',
      'ตัวบทที่ถูกต้อง (เลขคือวรรค):', units, '',
      'ให้ชี้เฉพาะจุดที่ "น่าสงสัย" ด้านอักขรวิธี: อ่านผิดคำ ข้ามคำ เติมคำ, ร/ล, คำควบกล้ำ, วรรณยุกต์เพี้ยนชัดเจน',
      'ห้ามประเมินความไพเราะหรือทำนอง ถ้าไม่แน่ใจให้ใส่ confidence ต่ำ ถ้าไม่พบปัญหาให้ flags เป็น []',
      'ตอบเป็น JSON เท่านั้น รูปแบบ: {"flags":[{"unit":เลขวรรค,"word":"คำในตัวบท","heard":"ที่ได้ยิน","note":"อธิบายสั้น ๆ","confidence":0-1}],"summary":"สรุป 1-2 ประโยค"}'
    ].join('\n');
    var body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: b.getContentType() || 'audio/webm', data: Utilities.base64Encode(b.getBytes()) } }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    };
    var res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) throw new Error('gemini ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
    var out = JSON.parse(res.getContentText()), txt = '';
    try { txt = out.candidates[0].content.parts.map(function (x) { return x.text || ''; }).join(''); } catch (e) { throw new Error('gemini-empty'); }
    var j; try { j = JSON.parse(txt.replace(/^\x60{3}(json)?|\x60{3}$/g, '').trim()); } catch (e) { throw new Error('gemini-badjson'); }
    var flags = (j.flags || []).slice(0, 30).map(function (x) {
      return { unit: Math.max(0, (+x.unit || 1) - 1), word: String(x.word || '').slice(0, 60), heard: String(x.heard || '').slice(0, 60), note: String(x.note || '').slice(0, 200), confidence: Math.max(0, Math.min(1, +x.confidence || 0)) };
    });
    return { flags: flags, summary: String(j.summary || '').slice(0, 400), model: model };
  } },

  /* ล้างไฟล์ (ย้ายลงถังขยะ กู้ได้ 30 วัน) */
  purge: { teacher: true, fn: function (r) {
    var done = [], failed = [];
    (r.fileIds || []).forEach(function (id) {
      try { var f = DriveApp.getFileById(id); if (!inRoot_(f) || meta_(f).kind !== 'attempt') throw new Error('skip'); f.setTrashed(true); done.push(id); }
      catch (e) { failed.push(id); }
    });
    return { trashed: done, failed: failed };
  } },

  /* พื้นที่ที่ใช้ แยกตามบท/ห้อง */
  usage: { teacher: true, fn: function () {
    var out = [], st = sub_(root_(), 'นักเรียน'), ps = st.getFolders();
    while (ps.hasNext()) {
      var pf = ps.next(), rs = pf.getFolders();
      while (rs.hasNext()) {
        var rf = rs.next(), fs = rf.getFiles(), n = 0, bytes = 0;
        while (fs.hasNext()) { var f = fs.next(); n++; bytes += f.getSize(); }
        out.push({ poem: pf.getName(), room: rf.getName(), files: n, bytes: bytes });
      }
    }
    return { rows: out };
  } }
};

/* ---------------------------------------------------------------- helpers */
function verify_(idToken) {
  if (!idToken) throw new Error('no token');
  var key = PropertiesService.getScriptProperties().getProperty('FB_API_KEY') || DEFAULT_FB_API_KEY;
  var cache = CacheService.getScriptCache(), ck = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken)).slice(0, 40);
  var hit = cache.get(ck); if (hit) return JSON.parse(hit);
  var res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + key, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('bad token');
  var u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u) throw new Error('bad token');
  var teachers = (PropertiesService.getScriptProperties().getProperty('TEACHERS') || DEFAULT_TEACHERS).toLowerCase().split(/\s*,\s*/);
  var email = (u.email || '').toLowerCase();
  var who = { uid: u.localId, email: email, teacher: !!(email && u.emailVerified && teachers.indexOf(email) >= 0) };
  cache.put(ck, JSON.stringify(who), 300);
  return who;
}
function root_() { var id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'); if (!id) { setup(); id = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'); } return DriveApp.getFolderById(id); }
function sub_(parent, name) { var it = parent.getFoldersByName(name); return it.hasNext() ? it.next() : parent.createFolder(name); }
function inRoot_(f) {
  var rootId = PropertiesService.getScriptProperties().getProperty('ROOT_FOLDER_ID'), q = [f], seen = 0;
  while (q.length && seen < 12) { var x = q.shift(), ps = x.getParents(); seen++; while (ps.hasNext()) { var p = ps.next(); if (p.getId() === rootId) return true; q.push(p); } }
  return false;
}
function meta_(f) { try { return JSON.parse(f.getDescription() || '{}'); } catch (e) { return {}; } }
function safe_(s) { return String(s).replace(/[\\\/:*?"<>|#%]/g, '-').slice(0, 80); }
function ext_(m) { m = String(m || ''); return m.indexOf('mp4') >= 0 || m.indexOf('aac') >= 0 ? '.m4a' : m.indexOf('mpeg') >= 0 || m.indexOf('mp3') >= 0 ? '.mp3' : m.indexOf('ogg') >= 0 ? '.ogg' : m.indexOf('wav') >= 0 ? '.wav' : '.webm'; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
