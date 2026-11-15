/* ฝั่งครู (PLAN ข้อ 8): คลังบทอ่าน + ตัวช่วยเพิ่มบท 4 ขั้น + ตัวแก้เวลาวรรค, ตรวจงาน + ยืนยันอักขรวิธี, จัดการ/ล้างข้อมูล, ตั้งค่า, ปรับเทียบ */
(function () {
'use strict';
const A = window.App, CFG = A.CFG, { $, $$, esc, fmtDate, thn, clamp, toast } = A;
const host = $('#view-teacher');
const T = { user: null, poems: [], rows: [], settings: {}, tab: 'poems', cur: null };
const fbd = () => A.fb.db;
const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const n0 = v => v == null ? '' : v;

host.innerHTML = `
<h2 class="sec" id="h-teacher" style="margin-top:22px">กระดานครู</h2>
<div class="card">
  <p class="note" style="margin:0 0 10px" id="t-msg">เข้าสู่ระบบด้วยบัญชี Google ของครู เพื่อจัดการบทอ่านและดูผลการอ่านของนักเรียน</p>
  <div class="acts"><button class="btn small" id="t-login">เข้าสู่ระบบด้วย Google</button><button class="btn small ghost" id="t-logout" hidden>ออกจากระบบ</button></div>
</div>
<div id="t-app" hidden>
  <div class="chips t-tabs" style="justify-content:flex-start;margin:6px 0 12px">
    <button class="chip" data-tt="poems">คลังบทอ่าน</button><button class="chip" data-tt="review">ตรวจงาน</button>
    <button class="chip" data-tt="manage">จัดการข้อมูล</button><button class="chip" data-tt="settings">ตั้งค่า</button>
  </div>
  <div id="tp-poems"></div><div id="tp-review" hidden></div><div id="tp-manage" hidden></div><div id="tp-settings" hidden></div>
</div>`;
const css = document.createElement('style');
css.textContent = `.t-tabs .chip{cursor:pointer;border:1.5px solid var(--gold-600,#b98618)}.t-tabs .chip[aria-current]{background:#13235a;color:#fbf3de}
.t-grid{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}.t-grid .fld{margin:0}
#view-teacher textarea{width:100%;min-height:160px;padding:10px 14px;border:1.5px solid var(--gold-600,#b98618);border-radius:8px;font:inherit;line-height:1.7}
.t-units{font-size:14px;width:100%;border-collapse:collapse}.t-units td,.t-units th{border-bottom:1px solid #eadcb4;padding:4px 6px;text-align:left;vertical-align:middle}
.t-units tr.sel{background:#fff3cf}.t-units input{width:68px;min-height:30px;padding:2px 6px;border:1px solid #cdb67a;border-radius:6px;font:inherit}
.t-units tr.flag td:first-child{border-left:4px solid #c2412d}.t-wave{width:100%;height:120px;background:#fffaf0;border:1px solid #e3cf98;border-radius:8px;touch-action:none;cursor:crosshair;display:block}
.t-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.t-pill{font-size:12px;padding:1px 8px;border-radius:99px;background:#f4e7c4}.t-pill.ok{background:#d9efdf}.t-pill.bad{background:#f7d6cf}
.t-flag{border:1px solid #e3cf98;border-radius:8px;padding:6px 10px;margin:6px 0;background:#fffaf0}.t-detail{border:2px solid #13235a}
.t-poem{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #eadcb4}`;
document.head.appendChild(css);

/* ================================================================ auth */
A.teacherInit = function () {
  if (!A.fb.on) { $('#t-msg').textContent = 'ยังไม่ได้เชื่อมฐานข้อมูล Firebase (ใส่ FB_CONFIG ใน js/config.js)'; $('#t-login').disabled = true; }
};
$('#t-login').addEventListener('click', async () => {
  if (!A.fb.on) return;
  try {
    const res = await A.fb.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
    T.user = res.user;
    $('#t-msg').textContent = 'เข้าสู่ระบบเป็น ' + res.user.email;
    $('#t-login').hidden = true; $('#t-logout').hidden = false; $('#t-app').hidden = false;
    await loadSettings(); await loadPoems(); showTab('poems');
  } catch (e) { $('#t-msg').textContent = 'เข้าสู่ระบบไม่สำเร็จ: ' + (e.message || e); }
});
$('#t-logout').addEventListener('click', async () => { await A.fb.auth.signOut(); location.reload(); });
host.addEventListener('click', e => { const b = e.target.closest('[data-tt]'); if (b) showTab(b.dataset.tt); });
function showTab(t) {
  T.tab = t;
  $$('[data-tt]', host).forEach(b => b.toggleAttribute('aria-current', b.dataset.tt === t));
  ['poems', 'review', 'manage', 'settings'].forEach(k => $('#tp-' + k).hidden = k !== t);
  if (t === 'poems') renderPoems(); if (t === 'review') loadReview(); if (t === 'manage') renderManage(); if (t === 'settings') renderSettings();
}
function denied(e) { return e && e.code === 'permission-denied' ? 'บัญชีนี้ไม่มีสิทธิ์ครู' : (e && e.message || String(e)); }

/* ================================================================ settings */
async function loadSettings() {
  try { const d = await fbd().doc('settings/app').get(); T.settings = d.exists ? d.data() : {}; } catch (e) { T.settings = {}; }
  T.settings = Object.assign({ retentionDays: 120, aiEnabled: true, weights: { melody: 40, rhythm: 30, ending: 20, complete: 10 }, pronWeight: 20 }, T.settings);
}
function renderSettings() {
  const s = T.settings, el = $('#tp-settings');
  el.innerHTML = `<div class="card"><h3>ตั้งค่าระบบ</h3>
    <div class="t-grid">
      <div class="fld"><label>เก็บเสียงนักเรียน (วัน)</label><input id="s-ret" type="number" min="7" max="3650" value="${s.retentionDays}"></div>
      <div class="fld"><label>AI ช่วยฟังอักขรวิธี</label><select id="s-ai"><option value="1"${s.aiEnabled ? ' selected' : ''}>เปิด</option><option value="0"${s.aiEnabled ? '' : ' selected'}>ปิด</option></select></div>
      <div class="fld"><label>สัดส่วนอักขรวิธีเริ่มต้น (%)</label><input id="s-pw" type="number" min="0" max="60" value="${s.pronWeight}"></div>
    </div>
    <p class="note">น้ำหนักคะแนนอัตโนมัติเริ่มต้น (รวม ๑๐๐)</p>
    <div class="t-grid">${wInputs('s-w', s.weights)}</div>
    <div class="acts" style="margin-top:12px"><button class="btn small" id="s-save">บันทึกการตั้งค่า</button></div>
    <p class="note" style="margin-top:14px">ครูในระบบ: ${esc(T.user.email)} (ผู้ดูแลหลัก) · เพิ่มครูได้โดยเพิ่มเอกสาร teachers/{อีเมล} ใน Firestore และเพิ่มอีเมลใน Script Properties ชื่อ TEACHERS ของ GAS</p>
    <p class="note">ตัวกลาง GAS: ${CFG.GAS_URL ? '<span class="t-pill ok">ตั้งค่าแล้ว</span> <button class="btn small ghost" id="s-ping">ทดสอบการเชื่อมต่อ</button>' : '<span class="t-pill bad">ยังไม่ได้ใส่ GAS_URL ใน js/config.js</span>'}</p></div>`;
  $('#s-save').onclick = async () => {
    const w = readW('s-w'); if (!w) return;
    const v = { retentionDays: +$('#s-ret').value || 120, aiEnabled: $('#s-ai').value === '1', pronWeight: clamp(+$('#s-pw').value || 0, 0, 60), weights: w, updatedAt: TS() };
    try { await fbd().doc('settings/app').set(v, { merge: true }); Object.assign(T.settings, v); toast('บันทึกการตั้งค่าแล้ว'); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + denied(e), 5000); }
  };
  const pg = $('#s-ping'); if (pg) pg.onclick = async () => { try { const t = performance.now(); await A.gas('ping'); toast('เชื่อมต่อ GAS ได้ (' + Math.round(performance.now() - t) + ' ms)'); } catch (e) { toast('เชื่อมต่อไม่ได้: ' + e.message, 6000); } };
}
const WN = { melody: 'ทำนอง', rhythm: 'จังหวะ', ending: 'ท้ายวรรค', complete: 'ครบถ้วน' };
function wInputs(pfx, w) { return Object.keys(WN).map(k => `<div class="fld"><label>${WN[k]}</label><input id="${pfx}-${k}" type="number" min="0" max="100" value="${w[k]}"></div>`).join(''); }
function readW(pfx) {
  const w = {}; let s = 0; Object.keys(WN).forEach(k => { w[k] = +$('#' + pfx + '-' + k).value || 0; s += w[k]; });
  if (s !== 100) { toast('น้ำหนักรวมต้องเท่ากับ ๑๐๐ (ตอนนี้ ' + thn(s) + ')', 4500); return null; }
  return w;
}

/* ================================================================ poems library */
async function loadPoems() {
  try { const qs = await fbd().collection('poems').get(); T.poems = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); }
  catch (e) { T.poems = []; $('#t-msg').textContent += ' · อ่านคลังบทไม่สำเร็จ: ' + denied(e); }
  T.poems.sort((a, b) => (b.updatedAt && b.updatedAt.seconds || 0) - (a.updatedAt && a.updatedAt.seconds || 0));
}
function renderPoems() {
  const el = $('#tp-poems');
  el.innerHTML = `<div class="card"><div class="t-row" style="justify-content:space-between"><h3 style="margin:0">คลังบทอ่าน</h3><button class="btn small gold" id="p-new">+ เพิ่มบทอ่าน</button></div>
    <div id="p-list">${T.poems.length ? '' : '<p class="note">ยังไม่มีบทอ่านในฐานข้อมูล (บทตัวอย่างกาพย์ยานีอยู่ในไฟล์ poems/ ของเว็บ)</p>'}</div></div><div id="p-edit"></div>`;
  $('#p-list').innerHTML += T.poems.map(p => `<div class="t-poem"><div><b>${esc(p.title)}</b><br><small>${esc(Forms.get(p.form).name)} · ${esc(p.level || '')} · ${thn((p.units || []).length)} วรรค · <span class="t-pill ${p.status === 'published' ? 'ok' : ''}">${p.status === 'published' ? 'เผยแพร่' : 'ร่าง'}</span>${p.calib && p.calib.accepted ? ' <span class="t-pill">ปรับเทียบแล้ว</span>' : ''}</small></div>
    <div class="t-row"><button class="btn small ghost" data-pe="${p.id}">แก้ไข</button><button class="btn small ghost" data-pv="${p.id}">ทดลองอ่าน</button><button class="btn small ghost" data-pc="${p.id}">ปรับเทียบ</button>
    <button class="btn small ghost" data-ps="${p.id}">${p.status === 'published' ? 'ซ่อน' : 'เผยแพร่'}</button></div></div>`).join('');
  $('#p-new').onclick = () => openEditor(null);
  $$('[data-pe]', el).forEach(b => b.onclick = () => openEditor(T.poems.find(p => p.id === b.dataset.pe)));
  $$('[data-pv]', el).forEach(b => b.onclick = () => window.open('?poem=' + encodeURIComponent(b.dataset.pv) + '&preview=1#listen', '_blank'));
  $$('[data-pc]', el).forEach(b => b.onclick = () => calibrate(T.poems.find(p => p.id === b.dataset.pc)));
  $$('[data-ps]', el).forEach(b => b.onclick = async () => {
    const p = T.poems.find(x => x.id === b.dataset.ps), st = p.status === 'published' ? 'draft' : 'published';
    try { await fbd().doc('poems/' + p.id).update({ status: st, updatedAt: TS() }); p.status = st; renderPoems(); } catch (e) { toast(denied(e), 5000); }
  });
}

/* ---------------------------------------------------------------- calibration (ช่วง 6) */
async function calibrate(p) {
  try {
    const qs = await fbd().collection(CFG.COLLECTION).where('poemId', '==', p.id).get();
    const pairs = qs.docs.map(d => d.data()).filter(x => x.teacher && x.teacher.override && Object.keys(x.teacher.override).length).map(x => ({ auto: x.auto || {}, teacher: x.teacher.override }));
    const c = A.fitCalib(pairs);
    if (!c.n) { toast('ยังมีงานที่ครูแก้คะแนนไม่ถึง ๘ ชิ้น (ตอนนี้ ' + thn(pairs.length) + ' ชิ้น) ระบบจึงยังปรับเทียบไม่ได้', 6500); return; }
    const lines = ['melody', 'rhythm', 'ending'].map(d => c[d] ? `${WN[d]}: ใหม่ = ${c[d].a} × อัตโนมัติ ${c[d].b >= 0 ? '+' : '−'} ${Math.abs(c[d].b)} (คลาดจากครูเฉลี่ย ${c[d].maeBefore} → ${c[d].maeAfter}, n=${c[d].n})` : `${WN[d]}: ข้อมูลไม่พอ`);
    if (!confirm('ผลปรับเทียบ "' + p.title + '"\n\n' + lines.join('\n') + '\n\nรับค่าปรับเทียบนี้ไหม? (มีผลกับการอ่านครั้งต่อไป)')) return;
    c.accepted = true; c.at = Date.now();
    await fbd().doc('poems/' + p.id).update({ calib: c, updatedAt: TS() }); p.calib = c; renderPoems(); toast('ใช้ค่าปรับเทียบแล้ว');
  } catch (e) { toast('ปรับเทียบไม่สำเร็จ: ' + denied(e), 5000); }
}

/* ---------------------------------------------------------------- poem editor (4 ขั้น) */
const E = { p: null, file: null, buf: null, chs: null, sr: 0, url: null, audio: null, sel: { u: 0, g: 0 }, review: [], view: [0, 1] };
let edAudio = new Audio();
function suggestSplit(text, formId, pos) {
  const F = Forms.get(formId), sp = F.split && F.split.length ? F.split[pos % F.split.length] : null;
  if (!sp || sp.length < 2 || !window.Intl || !Intl.Segmenter) return [text];
  const words = Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(text)).filter(s => s.isWordLike).map(s => s.segment);
  if (words.length < sp.length) return [text];
  const out = []; let i = 0;
  sp.forEach((k, j) => { const take = j === sp.length - 1 ? words.length - i : Math.min(k, words.length - i - (sp.length - j - 1)); out.push(words.slice(i, i + take).join('')); i += take; });
  return out.filter(Boolean);
}
function openEditor(p) {
  E.p = p ? JSON.parse(JSON.stringify(p)) : { title: '', form: 'kapyani11', level: '', text: '', units: [], weights: Object.assign({}, T.settings.weights), pronWeight: T.settings.pronWeight, status: 'draft' };
  E.file = null; E.buf = null; E.chs = null; E.review = [];
  const el = $('#p-edit');
  el.innerHTML = `<div class="card t-detail"><h3>${p ? 'แก้ไขบทอ่าน' : 'เพิ่มบทอ่านใหม่'}</h3>
  <p class="note"><b>ขั้น ก</b> ชื่อ ชนิดคำประพันธ์ และตัวบท — ขึ้นบรรทัดใหม่ = วรรค, “/” = เว้นจังหวะในวรรค, บรรทัดว่าง = ขึ้นบทใหม่</p>
  <div class="t-grid"><div class="fld" style="grid-column:span 2"><label>ชื่อบทอ่าน</label><input id="e-title" value="${esc(E.p.title)}" maxlength="100"></div>
   <div class="fld"><label>ชนิดคำประพันธ์</label><select id="e-form">${Forms.list().map(f => `<option value="${f.id}"${f.id === E.p.form ? ' selected' : ''}>${f.name}</option>`).join('')}</select></div>
   <div class="fld"><label>ระดับชั้น</label><input id="e-level" value="${esc(E.p.level || '')}" placeholder="เช่น ม.๑"></div></div>
  <textarea id="e-text" placeholder="เรือสิงห์/วิ่งเผ่นโผน&#10;โจนตามคลื่น/ฝืนฝาฟอง">${esc(E.p.text || '')}</textarea>
  <div class="acts"><button class="btn small ghost" id="e-parse">แยกวรรค / เสนอจุดเว้นจังหวะ</button><span class="note" id="e-parse-msg"></span></div>
  <hr><p class="note"><b>ขั้น ข</b> เสียงต้นแบบ (ไม่เกิน ${thn(Analyzer.MAX_REF_SEC)} วินาที / ๕ MB — ถ้ายาวกว่าให้แบ่งเป็นหลายบท)</p>
  <div class="t-row"><input type="file" id="e-file" accept="audio/*"><span class="note" id="e-audio-msg">${E.p.audio ? 'มีเสียงต้นแบบแล้ว (' + Math.round((E.p.audio.bytes || 0) / 1024) + ' KB)' : ''}</span></div>
  <div class="acts"><button class="btn small ghost" id="e-seg">แบ่งวรรคอัตโนมัติจากเสียง</button></div>
  <hr><p class="note"><b>ขั้น ค</b> ตรวจ/ปรับเวลาวรรค — แตะแถวเพื่อเลือกช่วง แล้วลากบนคลื่นเสียง (ซ้าย = จุดเริ่ม, ขวา = จุดจบ) หรือพิมพ์ตัวเลข · แถบแดง = ควรตรวจ</p>
  <canvas class="t-wave" id="e-wave" width="900" height="120"></canvas>
  <div class="t-row" style="margin:6px 0"><button class="btn small ghost" id="e-zoom">ซูมวรรคที่เลือก / ทั้งบท</button><button class="btn small ghost" id="e-tap">แตะตามจังหวะ</button><span class="note" id="e-tap-msg"></span></div>
  <div class="tbl-wrap"><table class="t-units" id="e-units"></table></div>
  <hr><p class="note"><b>ขั้น ง</b> น้ำหนักคะแนน (รวม ๑๐๐) และสัดส่วนอักขรวิธีในคะแนนสุดท้าย</p>
  <div class="t-grid">${wInputs('e-w', E.p.weights || T.settings.weights)}<div class="fld"><label>อักขรวิธี (%)</label><input id="e-pw" type="number" min="0" max="60" value="${n0(E.p.pronWeight)}"></div></div>
  <div class="acts" style="margin-top:12px"><button class="btn small" id="e-save">บันทึกร่าง</button><button class="btn small gold" id="e-pub">บันทึกและเผยแพร่</button><button class="btn small ghost" id="e-close">ปิด</button></div>
  <p class="note" id="e-msg"></p></div>`;
  $('#e-parse').onclick = parseText; $('#e-file').onchange = onFile; $('#e-seg').onclick = autoSeg;
  $('#e-save').onclick = () => savePoem('draft'); $('#e-pub').onclick = () => savePoem('published'); $('#e-close').onclick = () => { el.innerHTML = ''; edAudio.pause(); };
  $('#e-zoom').onclick = () => { const u = E.p.units[E.sel.u]; E.view = (E.view[1] - E.view[0] < dur() * 0.5 || !u) ? [0, dur()] : [Math.max(0, u.groups[0].t0 - 1), Math.min(dur(), u.groups[u.groups.length - 1].t1 + 1)]; drawWave(); };
  $('#e-tap').onclick = tapMode;
  setupWaveDrag();
  if (E.p.audio && E.p.audio.fileId) loadExistingAudio();
  renderUnits(); el.scrollIntoView({ behavior: 'smooth' });
}
function parseText() {
  const form = $('#e-form').value, text = $('#e-text').value, old = E.p.units || [];
  const units = Forms.parseText(text, form);
  const pos = {}; units.forEach(u => {
    pos[u.stanza] = (pos[u.stanza] || 0);
    if (!u.userSplit) u.groups = suggestSplit(u.groups[0].text, form, pos[u.stanza]).map(t => ({ text: t, t0: null, t1: null }));
    pos[u.stanza]++;
    const o = old[u.idx]; if (o && o.groups.length === u.groups.length) u.groups.forEach((g, j) => { g.t0 = o.groups[j].t0; g.t1 = o.groups[j].t1; });
    delete u.userSplit;
  });
  E.p.units = units; E.p.form = form;
  $('#e-text').value = units.reduce((s, u, i) => s + (i && u.stanza !== units[i - 1].stanza ? '\n' : '') + u.groups.map(g => g.text).join('/') + '\n', '').trim();
  $('#e-parse-msg').textContent = 'ได้ ' + thn(units.length) + ' วรรค ' + thn(new Set(units.map(u => u.stanza)).size) + ' บท (ตรวจจุดเว้นจังหวะ “/” ได้ในช่องข้อความ)';
  renderUnits(); drawWave();
}
const dur = () => E.buf ? E.buf.duration : 0;
async function onFile() {
  const f = $('#e-file').files[0]; if (!f) return;
  if (f.size > 5 * 1024 * 1024) { toast('ไฟล์ใหญ่เกิน ๕ MB', 4500); return; }
  try {
    E.file = f; E.buf = await A.decode(await f.arrayBuffer()); E.chs = A.channels(E.buf); E.sr = E.buf.sampleRate;
    if (E.url) URL.revokeObjectURL(E.url); E.url = URL.createObjectURL(f); edAudio.src = E.url;
    E.view = [0, dur()];
    $('#e-audio-msg').textContent = 'ไฟล์ใหม่ ' + Math.round(f.size / 1024) + ' KB · ยาว ' + thn(Math.round(dur())) + ' วินาที' + (dur() > Analyzer.MAX_REF_SEC + 10 ? ' — ยาวเกินกำหนด ควรแบ่งเป็นหลายบท' : '');
    drawWave();
  } catch (e) { toast('เปิดไฟล์เสียงไม่ได้', 4500); }
}
async function loadExistingAudio() {
  try { const url = await A.driveAudioUrl(E.p.audio.fileId); const ab = await (await fetch(url)).arrayBuffer(); E.buf = await A.decode(ab); E.chs = A.channels(E.buf); E.sr = E.buf.sampleRate; edAudio.src = url; E.view = [0, dur()]; drawWave(); }
  catch (e) { $('#e-audio-msg').textContent += ' (โหลดเสียงจาก Drive ไม่สำเร็จ: ' + e.message + ')'; }
}
async function autoSeg() {
  if (!E.p.units.length) parseText();
  if (!E.chs) { toast('เลือกไฟล์เสียงต้นแบบก่อน', 4000); return; }
  $('#e-msg').textContent = 'กำลังแบ่งวรรคจากเสียง…';
  try {
    const r = await A.engine('segment', E.chs.map(c => c.slice()), E.sr, { shape: Forms.shapeOf(E.p.units), opts: { syl: Forms.sylOf(E.p.units) } });
    if (!r.ok) throw new Error(r.error);
    r.units.forEach((u, i) => u.groups.forEach((g, j) => { E.p.units[i].groups[j].t0 = g[0]; E.p.units[i].groups[j].t1 = g[1]; }));
    E.p.refT0 = r.t0; E.p.refT1 = r.t1; E.review = r.review;
    $('#e-msg').textContent = (r.fallback ? 'หาช่องเงียบได้ไม่ครบ จึงแบ่งตามสัดส่วนพยางค์ — ตรวจทุกวรรค' : 'แบ่งแล้ว') + (r.review.length ? ' · ควรตรวจวรรคที่ ' + r.review.map(x => thn(x + 1)).join(' ') : ' · ไม่มีวรรคที่ระบบสงสัย') + (r.trimmed && r.trimmed.length ? ' · ตัดเสียงนำ/ท้ายออก ' + thn(r.trimmed.length) + ' ช่วง' : '');
    renderUnits(); drawWave();
  } catch (e) { $('#e-msg').textContent = 'แบ่งวรรคไม่สำเร็จ: ' + e.message; }
}
function renderUnits() {
  const tb = $('#e-units'); if (!tb) return;
  tb.innerHTML = '<tr><th>วรรค</th><th>ช่วง</th><th>เริ่ม</th><th>จบ</th><th></th></tr>' + E.p.units.map((u, i) => u.groups.map((g, j) =>
    `<tr data-u="${i}" data-g="${j}" class="${E.sel.u === i && E.sel.g === j ? 'sel' : ''}${E.review.includes(i) ? ' flag' : ''}"><td>${j === 0 ? thn(i + 1) + (u.role ? ' <small>' + esc(u.role) + '</small>' : '') : ''}</td><td>${esc(g.text)}</td>
    <td><input type="number" step="0.01" data-k="t0" value="${n0(g.t0)}"></td><td><input type="number" step="0.01" data-k="t1" value="${n0(g.t1)}"></td>
    <td><button class="btn small ghost" data-play>▶</button></td></tr>`).join('')).join('');
  $$('tr[data-u]', tb).forEach(tr => {
    const u = +tr.dataset.u, g = +tr.dataset.g;
    tr.onclick = e => { if (e.target.tagName === 'INPUT') return; E.sel = { u, g }; renderUnits(); drawWave(); if (e.target.closest('[data-play]')) playGroup(u, g); };
    $$('input', tr).forEach(inp => inp.onchange = () => { E.p.units[u].groups[g][inp.dataset.k] = inp.value === '' ? null : +(+inp.value).toFixed(2); E.sel = { u, g }; drawWave(); });
  });
}
function playGroup(u, g) {
  const G = E.p.units[u].groups[g]; if (G.t0 == null || !edAudio.src) return;
  edAudio.currentTime = G.t0; edAudio.play().catch(() => { });
  const iv = setInterval(() => { if (edAudio.currentTime >= G.t1 || edAudio.paused) { edAudio.pause(); clearInterval(iv); } }, 40);
}
function drawWave() {
  const cv = $('#e-wave'); if (!cv) return;
  const W = cv.width = cv.clientWidth * (window.devicePixelRatio || 1), H = cv.height = 120 * (window.devicePixelRatio || 1), c = cv.getContext('2d');
  c.clearRect(0, 0, W, H);
  if (!E.buf) { c.fillStyle = '#7a7c92'; c.font = (14 * (window.devicePixelRatio || 1)) + 'px Sarabun'; c.fillText('เลือกไฟล์เสียงต้นแบบเพื่อแสดงคลื่นเสียง', 12, H / 2); return; }
  const [v0, v1] = E.view, x = t => (t - v0) / (v1 - v0) * W, d = E.chs[0], sr = E.sr;
  E.p.units.forEach((u, i) => u.groups.forEach((g, j) => {
    if (g.t0 == null || g.t1 == null) return;
    const sel = E.sel.u === i && E.sel.g === j;
    c.fillStyle = sel ? 'rgba(239,192,74,.55)' : (j % 2 ? 'rgba(19,35,90,.10)' : 'rgba(19,35,90,.18)');
    c.fillRect(x(g.t0), 0, x(g.t1) - x(g.t0), H);
    if (j === 0) { c.fillStyle = E.review.includes(i) ? '#c2412d' : '#13235a'; c.font = (11 * (window.devicePixelRatio || 1)) + 'px Sarabun'; c.fillText(thn(i + 1), x(g.t0) + 3, 12 * (window.devicePixelRatio || 1)); }
    if (sel) { c.fillStyle = '#c2412d'; c.fillRect(x(g.t0) - 2, 0, 4, H); c.fillRect(x(g.t1) - 2, 0, 4, H); }
  }));
  c.strokeStyle = '#13235a'; c.beginPath();
  for (let px = 0; px < W; px++) {
    const s0 = Math.floor((v0 + (v1 - v0) * px / W) * sr), s1 = Math.floor((v0 + (v1 - v0) * (px + 1) / W) * sr);
    let mn = 0, mx = 0; for (let k = s0; k < s1; k += Math.max(1, (s1 - s0) >> 6)) { const v = d[k] || 0; if (v < mn) mn = v; if (v > mx) mx = v; }
    c.moveTo(px, H / 2 - mx * H * 0.48); c.lineTo(px, H / 2 - mn * H * 0.48);
  }
  c.stroke();
}
function setupWaveDrag() {
  const cv = $('#e-wave'); let drag = null;
  const tAt = ev => { const r = cv.getBoundingClientRect(); return E.view[0] + (E.view[1] - E.view[0]) * clamp((ev.clientX - r.left) / r.width, 0, 1); };
  cv.addEventListener('pointerdown', ev => {
    if (!E.buf || !E.p.units.length) return;
    const t = tAt(ev), g = E.p.units[E.sel.u] && E.p.units[E.sel.u].groups[E.sel.g]; if (!g) return;
    drag = g.t0 == null || Math.abs(t - g.t0) <= Math.abs(t - (g.t1 == null ? 1e9 : g.t1)) ? 't0' : 't1';
    cv.setPointerCapture(ev.pointerId); move(ev);
  });
  const move = ev => { if (!drag) return; const g = E.p.units[E.sel.u].groups[E.sel.g]; g[drag] = +tAt(ev).toFixed(2); if (g.t0 != null && g.t1 != null && g.t1 < g.t0 + 0.1) g[drag === 't0' ? 't0' : 't1'] = drag === 't0' ? +(g.t1 - 0.1).toFixed(2) : +(g.t0 + 0.1).toFixed(2); drawWave(); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', () => { if (drag) { drag = null; renderUnits(); } });
  window.addEventListener('resize', drawWave);
}
/* แตะตามจังหวะ: เล่นเสียงตั้งแต่ต้น แตะ (ปุ่มหรือ Space) เมื่อเริ่มช่วงใหม่ */
function tapMode() {
  if (!edAudio.src || !E.p.units.length) { toast('ต้องมีตัวบทและเสียงต้นแบบก่อน', 4000); return; }
  const flat = []; E.p.units.forEach(u => u.groups.forEach(g => flat.push(g)));
  let k = 0; const msg = $('#e-tap-msg'), btn = $('#e-tap');
  const tap = () => {
    const t = +edAudio.currentTime.toFixed(2);
    if (k > 0) flat[k - 1].t1 = +(t - 0.12).toFixed(2);
    if (k < flat.length) { flat[k].t0 = t; k++; msg.textContent = 'ถัดไป: ' + (flat[k] ? flat[k].text : '(แตะเพื่อจบช่วงสุดท้าย)'); }
    else finish();
    drawWave();
  };
  const key = e => { if (e.code === 'Space') { e.preventDefault(); tap(); } };
  const finish = () => { edAudio.pause(); if (flat[flat.length - 1].t1 == null || flat[flat.length - 1].t1 < flat[flat.length - 1].t0) flat[flat.length - 1].t1 = +edAudio.currentTime.toFixed(2); document.removeEventListener('keydown', key); btn.textContent = 'แตะตามจังหวะ'; btn.onclick = tapMode; msg.textContent = 'เสร็จแล้ว ตรวจและปรับละเอียดได้ในตาราง'; renderUnits(); };
  flat.forEach(g => { g.t0 = null; g.t1 = null; });
  edAudio.currentTime = 0; edAudio.play().catch(() => { });
  btn.textContent = 'แตะ!'; btn.onclick = tap; document.addEventListener('keydown', key); edAudio.onended = finish;
  msg.textContent = 'แตะเมื่อเริ่ม: ' + flat[0].text;
}
async function savePoem(status) {
  const msg = $('#e-msg');
  const title = $('#e-title').value.trim(); if (!title) { toast('ใส่ชื่อบทอ่าน'); return; }
  if ($('#e-text').value.trim() !== (E.p.text || '').trim() || !E.p.units.length) parseText();
  E.p.title = title; E.p.level = $('#e-level').value.trim(); E.p.text = $('#e-text').value; E.p.form = $('#e-form').value;
  const w = readW('e-w'); if (!w) return; E.p.weights = w; E.p.pronWeight = clamp(+$('#e-pw').value || 0, 0, 60);
  const miss = E.p.units.findIndex(u => u.groups.some(g => g.t0 == null || g.t1 == null || g.t1 <= g.t0));
  if (status === 'published') {
    if (miss >= 0) { toast('วรรคที่ ' + thn(miss + 1) + ' ยังไม่มีเวลาที่ถูกต้อง', 5000); return; }
    if (!E.file && !(E.p.audio && E.p.audio.fileId)) { toast('ยังไม่มีเสียงต้นแบบ', 4000); return; }
  }
  const all = []; E.p.units.forEach(u => u.groups.forEach(g => { if (g.t0 != null) all.push(g.t0); if (g.t1 != null) all.push(g.t1); }));
  if (all.length) { E.p.refT0 = +Math.max(0, Math.min.apply(null, all) - 0.08).toFixed(2); E.p.refT1 = +(Math.max.apply(null, all) + 0.08).toFixed(2); }
  if (E.p.refT1 - E.p.refT0 > Analyzer.MAX_REF_SEC) { toast('ช่วงเสียงต้นแบบยาวเกิน ' + thn(Analyzer.MAX_REF_SEC) + ' วินาที ให้แบ่งเป็นหลายบท', 6000); return; }
  try {
    const ref = E.p.id ? fbd().doc('poems/' + E.p.id) : fbd().collection('poems').doc();
    E.p.id = ref.id;
    if (E.file) {
      msg.textContent = 'กำลังอัปโหลดเสียงต้นแบบไป Google Drive…';
      const j = await A.gas('uploadRef', { data: await A.b64FromBlob(E.file), mime: E.file.type || 'audio/mpeg', name: title, poemId: ref.id });
      E.p.audio = { fileId: j.fileId, mime: E.file.type || 'audio/mpeg', bytes: j.bytes, duration: +dur().toFixed(2) }; E.file = null;
    }
    const doc = { title: E.p.title, form: E.p.form, level: E.p.level, text: E.p.text, units: E.p.units.map((u, i) => ({ stanza: u.stanza, idx: i, role: u.role || '', groups: u.groups.map(g => ({ text: g.text, t0: g.t0, t1: g.t1 })) })),
      refT0: E.p.refT0 == null ? null : E.p.refT0, refT1: E.p.refT1 == null ? null : E.p.refT1, audio: E.p.audio || null, weights: E.p.weights, pronWeight: E.p.pronWeight, calib: E.p.calib || null,
      status, ownerEmail: T.user.email, updatedAt: TS() };
    if (!T.poems.some(p => p.id === ref.id)) doc.createdAt = TS();
    await ref.set(doc, { merge: true });
    msg.textContent = status === 'published' ? 'เผยแพร่แล้ว นักเรียนเลือกบทนี้ได้ทันที' : 'บันทึกร่างแล้ว';
    const done = msg.textContent; await loadPoems(); renderPoems();
    openEditor(T.poems.find(p => p.id === ref.id)); $('#e-msg').textContent = done;
  } catch (e) { msg.textContent = 'บันทึกไม่สำเร็จ: ' + denied(e); }
}

/* ================================================================ review */
async function loadReview() {
  const el = $('#tp-review');
  el.innerHTML = '<div class="card"><p class="note">กำลังโหลดผลการอ่าน…</p></div>';
  try {
    const qs = await fbd().collection(CFG.COLLECTION).orderBy('createdAt', 'desc').limit(600).get();
    T.rows = qs.docs.map(d => Object.assign({ id: d.id }, d.data()));
  } catch (e) { el.innerHTML = '<div class="card"><p class="note">อ่านข้อมูลไม่สำเร็จ: ' + esc(denied(e)) + '</p></div>'; return; }
  const poems = [...new Set(T.rows.map(r => r.poemTitle || ''))];
  el.innerHTML = `<div class="card"><h3>ตรวจงาน</h3><div class="t-grid">
    <div class="fld"><label>บทอ่าน</label><select id="r-poem"><option value="">ทั้งหมด</option>${poems.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
    <div class="fld"><label>ห้อง</label><input id="r-room" placeholder="เช่น ม.๑/๑"></div>
    <div class="fld"><label>ตั้งแต่วันที่</label><input id="r-from" type="date"></div><div class="fld"><label>ถึงวันที่</label><input id="r-to" type="date"></div>
    <div class="fld"><label>สถานะ</label><select id="r-st"><option value="">ทั้งหมด</option><option value="wait">รอครูยืนยัน</option><option value="done">ยืนยันแล้ว</option></select></div></div>
    <div class="acts" style="margin-top:8px"><button class="btn small ghost" id="r-csv">ดาวน์โหลด CSV</button></div>
    <div class="tbl-wrap" id="r-tbl" style="margin-top:10px"></div></div><div id="r-detail"></div>`;
  ['r-poem', 'r-room', 'r-from', 'r-to', 'r-st'].forEach(id => $('#' + id).addEventListener('input', drawReview));
  $('#r-csv').onclick = csv;
  drawReview();
}
const au = r => r.auto || r;
function filteredRows() {
  const p = $('#r-poem') ? $('#r-poem').value : '', rm = $('#r-room') ? $('#r-room').value.trim() : '', f = $('#r-from') && $('#r-from').value, t = $('#r-to') && $('#r-to').value, st = $('#r-st') ? $('#r-st').value : '';
  const f0 = f ? new Date(f + 'T00:00:00').getTime() : 0, t1 = t ? new Date(t + 'T23:59:59').getTime() : Infinity;
  return T.rows.filter(r => (!p || r.poemTitle === p) && (!rm || (r.room || '').includes(rm)) && (r.clientAt || 0) >= f0 && (r.clientAt || 0) <= t1 &&
    (!st || (st === 'done' ? r.final != null : r.final == null)));
}
function drawReview() {
  const rs = filteredRows();
  $('#r-tbl').innerHTML = '<table><thead><tr><th>เวลา</th><th>ชื่อ</th><th>ห้อง</th><th>บท</th><th>อัตโนมัติ</th><th>สุดท้าย</th><th>เสียง</th><th>อักขรวิธี</th></tr></thead><tbody>' +
    rs.map(r => `<tr data-r="${r.id}" style="cursor:pointer"><td>${fmtDate(r.clientAt)}</td><td>${esc(r.name)}</td><td>${esc(r.room)}</td><td>${esc(r.poemTitle)}</td><td><b>${n0(au(r).total)}</b></td><td>${r.final != null ? '<b>' + r.final + '</b>' : '–'}</td><td>${r.audio ? '🔊' : '–'}</td><td>${pronTxt(r)}</td></tr>`).join('') + '</tbody></table>' +
    '<p class="note">' + thn(rs.length) + ' รายการ · แตะแถวเพื่อเปิดตรวจ</p>';
  $$('#r-tbl tr[data-r]').forEach(tr => tr.onclick = () => openReview(T.rows.find(r => r.id === tr.dataset.r)));
}
function pronTxt(r) { const s = r.pron && r.pron.status; return s === 'confirmed' ? '<span class="t-pill ok">ยืนยันแล้ว</span>' : s === 'ai' ? '<span class="t-pill">AI ฟังแล้ว</span>' : '<span class="t-pill">ยังไม่ตรวจ</span>'; }
let revAudio = new Audio();
async function openReview(r) {
  const el = $('#r-detail'), A0 = au(r), poem = T.poems.find(p => p.id === r.poemId);
  const pw = poem ? (poem.pronWeight || 0) : (T.settings.pronWeight || 0), W = poem && poem.weights || T.settings.weights;
  const ov = (r.teacher && r.teacher.override) || {}, pron = r.pron || { status: 'none' };
  const units = poem ? poem.units : [];
  el.innerHTML = `<div class="card t-detail"><div class="t-row" style="justify-content:space-between"><h3 style="margin:0">${esc(r.name)} · ${esc(r.room)}</h3><button class="btn small ghost" id="v-close">ปิด</button></div>
   <p class="note">${esc(r.poemTitle)} · ${fmtDate(r.clientAt)} · ความเร็ว ${n0(A0.tempo)}× · ${n0(A0.seconds)} วิ</p>
   <div id="v-audio">${r.audio ? '<button class="btn small" id="v-load">ฟังเสียงนักเรียน</button>' : '<p class="note">ไม่มีไฟล์เสียง (ยังอัปโหลดไม่เสร็จ หรือถูกล้างแล้ว)</p>'}</div>
   <div class="tbl-wrap"><table class="t-units"><tr><th>วรรค</th><th>ทำนอง</th><th>จังหวะ</th><th>ท้ายวรรค</th><th>ครบ</th><th>รวม</th><th></th></tr>
   ${(r.lines || []).map((L, i) => `<tr><td>${thn(i + 1)} <small>${esc(units[i] ? units[i].groups.map(g => g.text).join(' ') : '')}</small></td><td>${n0(L.m)}</td><td>${n0(L.r)}</td><td>${n0(L.e)}</td><td>${n0(L.c)}</td><td><b>${n0(L.t)}</b></td><td>${L.s != null && r.audio ? `<button class="btn small ghost" data-jump="${i}">▶</button>` : ''}</td></tr>`).join('')}</table></div>
   <h3 style="margin-top:14px">ปรับคะแนนรายด้าน (ถ้าไม่เห็นด้วยกับระบบ)</h3>
   <div class="t-grid">${['melody', 'rhythm', 'ending'].map(d => `<div class="fld"><label>${WN[d]} (ระบบ ${n0(A0[d])})</label><input type="number" min="0" max="100" id="v-o-${d}" value="${n0(ov[d])}" placeholder="${n0(A0[d])}"></div>`).join('')}</div>
   <h3 style="margin-top:14px">อักขรวิธี ${pw ? '(' + thn(pw) + '% ของคะแนนสุดท้าย)' : '(บทนี้ไม่คิดคะแนนอักขรวิธี)'}</h3>
   <div class="acts">${T.settings.aiEnabled && r.audio ? '<button class="btn small ghost" id="v-ai">ให้ AI ช่วยฟัง</button>' : ''}<span class="note" id="v-ai-msg"></span></div>
   <div id="v-flags"></div>
   <div class="t-grid"><div class="fld"><label>คะแนนอักขรวิธี (๐–๑๐๐)</label><input type="number" min="0" max="100" id="v-pron" value="${n0(pron.score)}"></div>
   <div class="fld" style="grid-column:span 2"><label>บันทึกของครู</label><input id="v-note" value="${esc((r.teacher && r.teacher.note) || pron.teacherNote || '')}"></div></div>
   <div class="acts" style="margin-top:10px"><button class="btn small gold" id="v-ok">ยืนยันคะแนน</button><span class="note" id="v-final"></span></div></div>`;
  el.scrollIntoView({ behavior: 'smooth' });
  $('#v-close').onclick = () => { el.innerHTML = ''; revAudio.pause(); };
  const lb = $('#v-load'); if (lb) lb.onclick = async () => {
    lb.disabled = true; lb.textContent = 'กำลังโหลด…';
    try { revAudio = new Audio(await A.driveAudioUrl(r.audio.fileId)); $('#v-audio').innerHTML = ''; revAudio.controls = true; $('#v-audio').appendChild(revAudio); } catch (e) { lb.textContent = 'โหลดไม่สำเร็จ: ' + e.message; }
  };
  $$('[data-jump]', el).forEach(b => b.onclick = async () => { if (!revAudio.src && lb) await lb.onclick(); const L = r.lines[+b.dataset.jump]; revAudio.currentTime = Math.max(0, L.s - 0.2); revAudio.play().catch(() => { }); const iv = setInterval(() => { if (revAudio.currentTime >= L.en + 0.3 || revAudio.paused) { revAudio.pause(); clearInterval(iv); } }, 60); });
  const flags = (pron.aiFlags || []).map(f => Object.assign({ ok: f.ok !== false }, f));
  const drawFlags = () => {
    $('#v-flags').innerHTML = (pron.aiSummary ? '<p class="note"><b>ข้อสังเกตจาก AI</b> (ยังไม่ใช่คะแนน): ' + esc(pron.aiSummary) + '</p>' : '') + flags.map((f, i) =>
      `<div class="t-flag"><label class="t-row"><input type="checkbox" data-fl="${i}"${f.ok ? ' checked' : ''}> <b>วรรค ${thn(f.unit + 1)}</b> “${esc(f.word)}” ได้ยินเป็น “${esc(f.heard)}” <span class="t-pill">${Math.round(f.confidence * 100)}%</span></label><small>${esc(f.note)}</small>
      ${r.audio && r.lines && r.lines[f.unit] ? ` <button class="btn small ghost" data-jump2="${f.unit}">▶ วรรคนี้</button>` : ''}</div>`).join('') + (pron.status === 'ai' && !flags.length ? '<p class="note">AI ไม่พบจุดน่าสงสัย</p>' : '');
    $$('[data-fl]', el).forEach(c => c.onchange = () => { flags[+c.dataset.fl].ok = c.checked; });
    $$('[data-jump2]', el).forEach(b => b.onclick = () => { const x = el.querySelector('[data-jump="' + b.dataset.jump2 + '"]'); if (x) x.click(); });
  };
  drawFlags();
  const ab = $('#v-ai'); if (ab) ab.onclick = async () => {
    ab.disabled = true; $('#v-ai-msg').textContent = 'AI กำลังฟัง (อาจใช้เวลา ๑๐–๓๐ วินาที)…';
    try {
      const j = await A.gas('aiListen', { fileId: r.audio.fileId, units: units.map(u => u.groups.map(g => g.text).join(' ')) });
      flags.length = 0; j.flags.forEach(f => flags.push(Object.assign({ ok: f.confidence >= 0.5 }, f)));
      pron.status = pron.status === 'confirmed' ? 'confirmed' : 'ai'; pron.aiFlags = j.flags; pron.aiSummary = j.summary;
      await fbd().doc(CFG.COLLECTION + '/' + r.id).update({ 'pron.status': pron.status, 'pron.aiFlags': j.flags, 'pron.aiSummary': j.summary, 'pron.aiModel': j.model, 'pron.aiAt': Date.now() });
      r.pron = pron; $('#v-ai-msg').textContent = 'AI ฟังแล้ว ' + thn(j.flags.length) + ' ข้อสังเกต — ติ๊กรับเฉพาะข้อที่ครูเห็นด้วย'; drawFlags(); drawReview();
    } catch (e) { $('#v-ai-msg').textContent = 'AI ฟังไม่สำเร็จ: ' + e.message; ab.disabled = false; }
  };
  $('#v-ok').onclick = async () => {
    const o = {}; ['melody', 'rhythm', 'ending'].forEach(d => { const v = $('#v-o-' + d).value; if (v !== '') o[d] = clamp(+v, 0, 100); });
    const ps = $('#v-pron').value;
    if (pw > 0 && ps === '') { toast('ใส่คะแนนอักขรวิธีก่อนยืนยัน', 4000); return; }
    const dims = Object.assign({ melody: A0.melody, rhythm: A0.rhythm, ending: A0.ending, complete: A0.complete }, o);
    let s = 0, t = 0; for (const k in W) if (dims[k] != null && W[k] > 0) { s += W[k] * dims[k]; t += W[k]; }
    const autoTot = Object.keys(o).length ? Math.round(s / t) : A0.total;
    const final = Math.round(autoTot * (1 - pw / 100) + (pw ? clamp(+ps, 0, 100) * pw / 100 : 0));
    const upd = {
      teacher: { override: o, note: $('#v-note').value.trim() }, final,
      pron: Object.assign({}, pron, { status: 'confirmed', score: ps === '' ? null : clamp(+ps, 0, 100), aiFlags: flags.map(f => ({ unit: f.unit, word: f.word, heard: f.heard, note: f.note, confidence: f.confidence, ok: !!f.ok })), teacherNote: $('#v-note').value.trim(), confirmedBy: T.user.email, confirmedAt: Date.now() })
    };
    try { await fbd().doc(CFG.COLLECTION + '/' + r.id).update(upd); Object.assign(r, upd); $('#v-final').textContent = 'ยืนยันแล้ว คะแนนสุดท้าย ' + thn(final); drawReview(); } catch (e) { toast('บันทึกไม่สำเร็จ: ' + denied(e), 5000); }
  };
}
function csv() {
  const rows = [['เวลา', 'ชื่อ', 'ห้อง', 'บทอ่าน', 'อัตโนมัติ', 'ทำนอง', 'จังหวะ', 'ท้ายวรรค', 'ครบถ้วน', 'อักขรวิธี', 'คะแนนสุดท้าย', 'ความเร็วเทียบต้นแบบ', 'บันทึกครู']].concat(filteredRows().map(r => { const a = au(r); return [new Date(r.clientAt || 0).toISOString(), r.name, r.room, r.poemTitle, a.total, a.melody, a.rhythm, a.ending, a.complete, r.pron && r.pron.score, r.final, a.tempo, r.teacher && r.teacher.note]; }));
  const s = '﻿' + rows.map(r => r.map(c => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"').join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' })); a.download = 'senoh-results.csv'; a.click();
}

/* ================================================================ manage / purge */
async function renderManage() {
  const el = $('#tp-manage');
  if (!T.rows.length) { try { const qs = await fbd().collection(CFG.COLLECTION).orderBy('createdAt', 'desc').limit(2000).get(); T.rows = qs.docs.map(d => Object.assign({ id: d.id }, d.data())); } catch (e) { } }
  const poems = [...new Set(T.rows.map(r => r.poemTitle || ''))], ret = T.settings.retentionDays;
  const old = T.rows.filter(r => r.audio && (Date.now() - (r.clientAt || 0)) > ret * 864e5).length;
  el.innerHTML = `<div class="card"><h3>พื้นที่ใน Google Drive</h3><div id="m-usage"><button class="btn small ghost" id="m-u">ดูพื้นที่ที่ใช้</button></div>
    ${old ? `<p class="note">มีเสียงเก่ากว่า ${thn(ret)} วัน (ตามที่ตั้งค่า) อยู่ ${thn(old)} ไฟล์ — ใช้แบบฟอร์มด้านล่าง เลือก “เก่ากว่า ${thn(ret)} วัน”</p>` : ''}</div>
   <div class="card"><h3>ล้างข้อมูล</h3><div class="t-grid">
    <div class="fld"><label>บทอ่าน</label><select id="m-poem"><option value="">ทุกบท</option>${poems.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
    <div class="fld"><label>ห้อง</label><input id="m-room" placeholder="เว้นว่าง = ทุกห้อง"></div>
    <div class="fld"><label>เก่ากว่า (วัน)</label><input id="m-old" type="number" min="0" placeholder="เช่น ${ret}"></div>
    <div class="fld"><label>หรือ ตั้งแต่</label><input id="m-from" type="date"></div><div class="fld"><label>ถึง</label><input id="m-to" type="date"></div>
    <div class="fld"><label>สิ่งที่จะล้าง</label><select id="m-mode"><option value="audio">เฉพาะไฟล์เสียง (คงคะแนน)</option><option value="all">ทั้งเสียงและผลการอ่าน</option></select></div></div>
    <div class="acts" style="margin-top:10px"><button class="btn small ghost" id="m-prev">ตรวจจำนวนก่อนล้าง</button><button class="btn small" id="m-go" disabled style="background:#c2412d">ล้างข้อมูล</button></div>
    <p class="note" id="m-msg">ไฟล์เสียงจะถูกย้ายลงถังขยะของ Google Drive (กู้คืนได้ภายใน ๓๐ วัน)</p></div>`;
  $('#m-u').onclick = async () => {
    try { const j = await A.gas('usage'); const tot = j.rows.reduce((s, x) => s + x.bytes, 0);
      $('#m-usage').innerHTML = '<table><tr><th>บท (รหัส)</th><th>ห้อง</th><th>ไฟล์</th><th>ขนาด</th></tr>' + j.rows.map(x => `<tr><td>${esc((T.poems.find(p => p.id === x.poem) || {}).title || x.poem)}</td><td>${esc(x.room)}</td><td>${x.files}</td><td>${(x.bytes / 1048576).toFixed(1)} MB</td></tr>`).join('') + `</table><p class="note">รวม ${(tot / 1048576).toFixed(1)} MB</p>`;
    } catch (e) { $('#m-usage').textContent = 'ดูไม่ได้: ' + e.message; }
  };
  let sel = [];
  $('#m-prev').onclick = () => {
    const p = $('#m-poem').value, rm = $('#m-room').value.trim(), od = $('#m-old').value, f = $('#m-from').value, t = $('#m-to').value, mode = $('#m-mode').value;
    const f0 = f ? new Date(f + 'T00:00:00').getTime() : 0, t1 = t ? new Date(t + 'T23:59:59').getTime() : Infinity, cut = od !== '' ? Date.now() - (+od) * 864e5 : Infinity;
    sel = T.rows.filter(r => (!p || r.poemTitle === p) && (!rm || (r.room || '').includes(rm)) && (r.clientAt || 0) >= f0 && (r.clientAt || 0) <= t1 && (r.clientAt || 0) < cut && (mode === 'all' || r.audio));
    const bytes = sel.reduce((s, r) => s + (r.audio && r.audio.bytes || 0), 0), nA = sel.filter(r => r.audio).length;
    $('#m-msg').innerHTML = `จะล้าง <b>${thn(sel.length)}</b> รายการ (ไฟล์เสียง ${thn(nA)} ไฟล์ ≈ ${(bytes / 1048576).toFixed(1)} MB)${mode === 'all' ? ' <b>และลบผลการอ่านออกจากฐานข้อมูลถาวร</b>' : ' คะแนนยังอยู่'}`;
    $('#m-go').disabled = !sel.length;
  };
  $('#m-go').onclick = async () => {
    const mode = $('#m-mode').value;
    if (!confirm('ยืนยันล้าง ' + sel.length + ' รายการ?' + (mode === 'all' ? '\nผลการอ่านจะถูกลบถาวร' : ''))) return;
    $('#m-go').disabled = true; $('#m-msg').textContent = 'กำลังล้าง…';
    try {
      const ids = sel.filter(r => r.audio && r.audio.fileId).map(r => r.audio.fileId);
      let trashed = [];
      for (let i = 0; i < ids.length; i += 100) { const j = await A.gas('purge', { fileIds: ids.slice(i, i + 100) }); trashed = trashed.concat(j.trashed); }
      for (let i = 0; i < sel.length; i += 400) {
        const b = fbd().batch();
        sel.slice(i, i + 400).forEach(r => { const ref = fbd().doc(CFG.COLLECTION + '/' + r.id); if (mode === 'all') b.delete(ref); else b.update(ref, { audio: null }); });
        await b.commit();
      }
      if (mode === 'all') T.rows = T.rows.filter(r => !sel.includes(r)); else sel.forEach(r => r.audio = null);
      $('#m-msg').textContent = 'ล้างแล้ว: ย้ายไฟล์ลงถังขยะ ' + thn(trashed.length) + ' ไฟล์' + (mode === 'all' ? ' และลบผล ' + thn(sel.length) + ' รายการ' : '');
    } catch (e) { $('#m-msg').textContent = 'ล้างไม่สำเร็จ: ' + denied(e); }
  };
}
})();
