/* ข้อมูล: เครื่องมือร่วม, บทอ่าน, ที่เก็บในเครื่อง, Firebase
   ไฟล์นี้สร้าง window.App ให้ student.js / teacher.js ใช้ร่วมกัน */
(function () {
'use strict';
const CFG = window.APP_CONFIG;
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const TH = '๐๑๒๓๔๕๖๗๘๙';
const thn = n => String(n).replace(/\d/g, d => TH[d]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function store(key, val) { try { if (val === undefined) return JSON.parse(localStorage.getItem(key)); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; } }
let toastT;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms || 3200);
}
function fmtTime(s) { s = Math.max(0, s); return thn(Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')); }
function fmtDate(ts) { try { return new Date(ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------------------------------------------------------- บทอ่าน */
function poemSpec(p) {
  return { t0: p.refT0, t1: p.refT1, units: p.units.map(u => ({ groups: u.groups.map(g => [g.t0, g.t1]) })) };
}
async function poemAudioUrl(p) { if (p.audio && p.audio.url) return p.audio.url; if (p.audio && p.audio.fileId) return driveAudioUrl(p.audio.fileId); return null; }
async function loadIndex() {
  try { const r = await fetch(CFG.POEM_INDEX, { cache: 'no-cache' }); if (r.ok) return (await r.json()).poems || []; } catch (e) { }
  return [];
}
async function loadPoem(id, opt) {
  opt = opt || {};
  await waitAuth(4000);
  const [local, remote] = await Promise.all([loadIndex(), remotePoems(!!opt.preview)]);
  const index = remote.filter(x => x.status === 'published').map(x => ({ id: x.id, title: x.title, form: x.form, level: x.level, remote: true }))
    .concat(local.filter(x => !remote.some(r => r.id === x.id)));
  let p = remote.find(x => x.id === id);
  if (!p) {
    const hit = local.find(x => x.id === id);
    let r = await fetch(hit ? hit.url : 'poems/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' });
    if (!r.ok) {
      const rd = remote.find(x => x.id === CFG.DEFAULT_POEM && x.status === 'published');
      if (rd) p = rd;
      else { const d = local.find(x => x.id === CFG.DEFAULT_POEM); r = await fetch(d ? d.url : 'poems/' + CFG.DEFAULT_POEM + '.json', { cache: 'no-cache' }); }
    }
    if (!p) { if (!r.ok) throw new Error('poem http ' + r.status); p = await r.json(); }
  }
  if (!p.units || !p.units.length) throw new Error('poem-empty');
  p.units.forEach((u, i) => { u.idx = i; if (u.stanza == null) u.stanza = 0; });
  if (p.refT0 == null) p.refT0 = Math.max(0, p.units[0].groups[0].t0 - 0.08);
  if (p.refT1 == null) { const L = p.units[p.units.length - 1].groups; p.refT1 = L[L.length - 1].t1 + 0.08; }
  return { poem: p, index };
}

/* ---------------------------------------------------------------- ผลการอ่านในเครื่อง (ย้ายข้อมูลจากระบบเดิมครั้งแรก) */
function loadAttempts() {
  let a = store(CFG.LS_KEY);
  if (!a) {
    const old = store(CFG.LEGACY_LS_KEY) || [];
    a = old.map(x => Object.assign({ poemId: 'yani11', poemTitle: 'กาพย์ยานี ๑๑ (ระบบเดิม)' }, x, { synced: false, legacy: true }));
    store(CFG.LS_KEY, a);
  }
  return a;
}
function loadUser() { return store(CFG.LS_USER) || store(CFG.LEGACY_LS_USER) || { name: '', room: '' }; }

/* ---------------------------------------------------------------- Firebase */
const fb = { on: false, user: null, db: null, auth: null, listeners: [] };
function initFirebase() {
  if (fb.on || !CFG.FB_CONFIG.apiKey || typeof firebase === 'undefined') return;
  try {
    firebase.initializeApp(CFG.FB_CONFIG); fb.auth = firebase.auth(); fb.db = firebase.firestore(); fb.on = true;
    fb.auth.onAuthStateChanged(u => {
      fb.user = u;
      if (u && !u.isAnonymous) return;
      if (!u) { fb.auth.signInAnonymously().catch(() => { fb.on = false; }); return; }
      fb.listeners.forEach(f => { try { f(u); } catch (e) { } });
    });
  } catch (e) { fb.on = false; }
}
function attemptDoc(a) {
  return {
    uid: fb.user.uid, name: a.name || '', room: a.room || '', poemId: a.poemId || '', poemTitle: a.poemTitle || '',
    clientAt: a.ts, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    auto: { total: a.total, melody: a.melody, rhythm: a.rhythm, ending: a.ending, complete: a.complete == null ? null : a.complete, tempo: a.tempo, seconds: a.seconds, snr: a.snr == null ? null : a.snr, offsetSt: a.offsetSt == null ? null : a.offsetSt },
    total: a.total, lines: a.lines, audio: null, pron: { status: 'none' }, final: null, app: 'senoh', v: 2
  };
}


/* ---------------------------------------------------------------- GAS (ตัวกลาง Drive + AI) */
async function idToken() { return A0.fb.user ? A0.fb.user.getIdToken() : ''; }
async function gas(action, payload) {
  if (!CFG.GAS_URL) throw new Error('ยังไม่ได้ตั้ง GAS_URL');
  const body = JSON.stringify(Object.assign({ action, idToken: await idToken() }, payload || {}));
  const r = await fetch(CFG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'gas');
  return j;
}
function b64FromBlob(blob) { return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(blob); }); }
function blobFromB64(b64, mime) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime || 'application/octet-stream' }); }
/* เสียงจาก Drive: แคชใน Cache Storage ตาม fileId */
async function driveAudioUrl(fileId) {
  const key = new Request(location.origin + '/__drive-audio/' + fileId);
  let cache = null; try { cache = await caches.open('senoh-audio'); const hit = await cache.match(key); if (hit) return URL.createObjectURL(await hit.blob()); } catch (e) { cache = null; }
  const j = await gas('getAudio', { fileId });
  const blob = blobFromB64(j.data, j.mime);
  if (cache) { try { await cache.put(key, new Response(blob, { headers: { 'Content-Type': j.mime || 'audio/mpeg' } })); } catch (e) { } }
  return URL.createObjectURL(blob);
}

/* ---------------------------------------------------------------- คิวอัปโหลดเสียงนักเรียน (IndexedDB) */
function idb() {
  return new Promise((res, rej) => { const q = indexedDB.open('senoh', 1); q.onupgradeneeded = () => q.result.createObjectStore('uploads'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}
async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('uploads', mode), st = tx.objectStore('uploads'), r = fn(st); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const queuePut = (id, v) => idbDo('readwrite', st => st.put(v, id));
const queueDel = id => idbDo('readwrite', st => st.delete(id));
const queueAll = () => idbDo('readonly', st => st.getAllKeys());
const queueGet = id => idbDo('readonly', st => st.get(id));
let uploading = false;
async function flushUploads() {
  if (uploading || !CFG.GAS_URL || !A0.fb.on || !A0.fb.user) return;
  uploading = true;
  try {
    const keys = await queueAll();
    for (const id of keys) {
      const it = await queueGet(id); if (!it) continue;
      if (!it.synced) { const a = (A0.state && A0.state.attempts || []).find(x => x.id === id); if (!a || !a.synced) continue; }
      try {
        const j = await gas('uploadAttempt', { data: await b64FromBlob(it.blob), mime: it.blob.type, poemId: it.poemId, room: it.room, name: it.name, attemptId: id });
        await A0.fb.db.collection(CFG.COLLECTION).doc(id).update({ audio: { fileId: j.fileId, bytes: j.bytes, mime: it.blob.type } });
        await queueDel(id);
      } catch (e) { if (/too large/.test(e.message)) await queueDel(id); break; }
    }
  } catch (e) { }
  uploading = false;
}
setInterval(flushUploads, 60000);
window.addEventListener('online', flushUploads);

/* ---------------------------------------------------------------- บทอ่านใน Firestore */
async function remotePoems(all) {
  const fb = A0.fb; if (!fb.on || !fb.user) return [];
  try {
    const q = all ? fb.db.collection('poems') : fb.db.collection('poems').where('status', '==', 'published');
    const qs = await q.get();
    return qs.docs.map(d => Object.assign({ id: d.id, remote: true }, d.data()));
  } catch (e) { return []; }
}
function waitAuth(ms) { return new Promise(res => { if (!A0.fb.on || A0.fb.user) return res(); const t = setTimeout(res, ms || 4000); A0.fb.listeners.push(() => { clearTimeout(t); res(); }); }); }

/* ---------------------------------------------------------------- ปรับเทียบกับครู (ช่วง 6) */
const DIMS = ['melody', 'rhythm', 'ending'];
function applyCalib(res, calib, weights) {
  if (!calib || !calib.accepted) return res;
  const f = (d, v) => calib[d] ? clamp(Math.round(calib[d].a * v + calib[d].b), 0, 100) : v;
  const W = weights || { melody: 40, rhythm: 30, ending: 20, complete: 10 };
  const tot = o => { let s = 0, t = 0; for (const k in W) if (o[k] != null && W[k] > 0) { s += W[k] * o[k]; t += W[k]; } return t ? Math.round(s / t) : 0; };
  res.lines.forEach(L => { DIMS.forEach(d => L[d] = f(d, L[d])); L.total = tot(L); });
  DIMS.forEach(d => res[d] = f(d, res[d]));
  res.total = tot(res); res.calibrated = true;
  return res;
}
/* least squares y = a·x + b ต่อด้าน, a ∈ [0.5, 1.5] */
function fitCalib(pairs) {
  const out = { n: 0 };
  DIMS.forEach(d => {
    const xs = [], ys = [];
    pairs.forEach(p => { if (p.teacher && p.teacher[d] != null && p.auto[d] != null) { xs.push(+p.auto[d]); ys.push(+p.teacher[d]); } });
    if (xs.length < 8) return;
    const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
    let a = sxx > 1e-6 ? sxy / sxx : 1; a = clamp(a, 0.5, 1.5);
    const b = my - a * mx;
    let e0 = 0, e1 = 0; for (let i = 0; i < n; i++) { e0 += Math.abs(ys[i] - xs[i]); e1 += Math.abs(ys[i] - (a * xs[i] + b)); }
    out[d] = { a: +a.toFixed(3), b: +b.toFixed(2), n, maeBefore: +(e0 / n).toFixed(1), maeAfter: +(e1 / n).toFixed(1) };
    out.n = Math.max(out.n, n);
  });
  return out;
}

const A0 = {
  CFG, $, $$, thn, clamp, store, toast, fmtTime, fmtDate, esc,
  poemSpec, poemAudioUrl, loadIndex, loadPoem, loadAttempts, loadUser,
  fb, initFirebase, attemptDoc, gas, b64FromBlob, blobFromB64, driveAudioUrl, queuePut, flushUploads, remotePoems, waitAuth, applyCalib, fitCalib
};
window.App = A0;
})();
