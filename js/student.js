/* ฝั่งนักเรียน: ฟังต้นแบบ อ่านตาม ผล ประวัติ — ปรับจากระบบเดิมให้รับบทอ่านจาก JSON (poem.units) */
(function () {
'use strict';
const A = window.App, CFG = A.CFG, { $, $$, thn, clamp, store, toast, fmtTime, fmtDate, esc } = A;

/* ---------------------------------------------------------------- engine */
let worker = null; const pend = new Map(); let nid = 1;
try {
  worker = new Worker('js/analyzer.worker.js');
  worker.onmessage = e => { const m = e.data, p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.ok ? p.res(m.r) : p.rej(new Error(m.e)); };
  worker.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); worker = null; const ps = Array.from(pend.values()); pend.clear(); ps.forEach(p => p.retry()); };
} catch (e) { worker = null; }
function runLocal(msg) {
  const L = window.Analyzer;
  if (msg.cmd === 'ref') return L.prepareRef(msg.chs, msg.sr, msg.spec);
  if (msg.cmd === 'segment') return L.segment(msg.chs, msg.sr, msg.shape, msg.opts);
  return L.score(msg.chs, msg.sr, msg.opts);
}
let localRefSpec = null;   // ถ้า worker ล้มกลางทาง ต้องเตรียมต้นแบบในเธรดหลักใหม่
function engine(cmd, chs, sr, extra) {
  const msg = Object.assign({ cmd, chs, sr }, extra || {});
  return new Promise((res, rej) => {
    const local = () => setTimeout(() => {
      try {
        if (cmd !== 'ref' && cmd !== 'segment' && localRefSpec && !localRefSpec.done) { /* เตรียมต้นแบบใหม่ในเธรดหลัก */
          const r = runLocal({ cmd: 'ref', chs: localRefSpec.chs, sr: localRefSpec.sr, spec: localRefSpec.spec }); localRefSpec.done = !!r.ok;
        }
        res(runLocal(msg));
      } catch (e) { rej(e); }
    }, 40);
    if (worker) {
      const id = nid++;
      pend.set(id, { res, rej, retry: local });
      // ไม่โอน buffer (transfer) เพื่อให้ใช้ซ้ำได้ถ้า worker ล้ม
      worker.postMessage(Object.assign({ id }, msg));
    } else local();
  });
}
let actx = null;
function ctx() { return actx || (actx = new (window.AudioContext || window.webkitAudioContext)()); }
function decode(ab) { return new Promise((res, rej) => { const p = ctx().decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); }); }
function channels(buf) { const o = []; for (let c = 0; c < buf.numberOfChannels; c++) o.push(buf.getChannelData(c).slice()); return o; }

/* ---------------------------------------------------------------- state */
const state = { tab: 'listen', ref: 'loading', user: A.loadUser(), micOk: false, last: null, rec: null, attempts: A.loadAttempts(), poem: null, refSec: 41 };
A.state = state;
let P = null, U = [], NU = 0;   // บทอ่านปัจจุบัน, units, จำนวนวรรค

/* ---------------------------------------------------------------- router */
const TABS = ['listen', 'read', 'result', 'history', 'teacher'];
function go(name, noHash) {
  if (!TABS.includes(name)) name = 'listen';
  if (state.tab === 'listen' && name !== 'listen') stopRef();
  state.tab = name;
  $$('.view').forEach(v => v.classList.toggle('is-active', v.id === 'view-' + name));
  $$('nav [data-go]').forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (!noHash && location.hash !== '#' + name) history.replaceState(null, '', location.search + '#' + name);
  if (name === 'result') $('.tabbar [data-go=result]').classList.remove('has-dot');
  if (name === 'history') renderHistory();
  if (name === 'teacher' && A.teacherInit) A.teacherInit();
  window.scrollTo(0, 0);
  observeReveal();
}
A.go = go;
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) { e.preventDefault(); go(b.dataset.go); } });
$('#a-teacher').addEventListener('click', e => { e.preventDefault(); go('teacher'); });
window.addEventListener('hashchange', () => go(location.hash.slice(1), true));

/* ---------------------------------------------------------------- verse */
const PAUSE = '<span class="pause"></span>';
const unitText = (u, sep) => u.groups.map(g => esc(g.text)).join(sep == null ? PAUSE : sep);
function unitLabel(u) {
  const pos = U.filter(x => x.stanza === u.stanza).indexOf(u);
  const sp = Forms.splitLabel(P.form, pos, u.groups.length);
  return [u.role ? 'วรรค' + u.role : '', sp ? thn(sp) + ' คำ' : ''].filter(Boolean).join(' · ');
}
function renderVerse(host, interactive) {
  host.innerHTML = '';
  const nSt = new Set(U.map(u => u.stanza)).size;
  let lastSt = -1;
  U.forEach((u, i) => {
    if (u.stanza !== lastSt && nSt > 1) { const h = document.createElement('div'); h.className = 'bot'; h.textContent = 'บทที่ ' + thn(u.stanza + 1); host.appendChild(h); }
    lastSt = u.stanza;
    const row = document.createElement('div');
    row.className = 'wak' + (interactive ? '' : ' static'); row.dataset.i = i;
    const lab = unitLabel(u);
    row.innerHTML = '<span class="no"><span>' + thn(i + 1) + '</span></span>' +
      '<div class="txt">' + u.groups.map((g, h) => '<span class="h" data-h="' + h + '">' + esc(g.text) + '</span>').join(PAUSE) +
      (lab ? '<span class="role">' + lab + '</span>' : '') + '</div>' +
      (interactive ? '<span class="go"><svg><use href="#i-play"/></svg></span>' : '');
    if (interactive) { row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', 'ฟังวรรคที่ ' + (i + 1)); }
    host.appendChild(row);
  });
}

/* ---------------------------------------------------------------- reference player */
const refA = new Audio(); refA.preload = 'auto';
const ui = { player: $('#player'), fill: $('#tr-fill'), knob: $('#tr-knob'), time: $('#pl-time'), title: $('#pl-title'), track: $('#track') };
let seg = null, rafId = 0, T0 = 0, T1 = 1;
const gFirst = i => U[i].groups[0], gLast = i => U[i].groups[U[i].groups.length - 1];
const lineS = i => gFirst(i).t0 - 0.12, lineE = i => gLast(i).t1 + 0.18;

function setPlaying(on) { ui.player.classList.toggle('playing', on); }
function stopRef() { refA.pause(); seg = null; setPlaying(false); clearKaraoke(); ui.title.textContent = 'เสียงต้นแบบทั้งบท'; }
function playFull() {
  seg = null;
  if (refA.currentTime < T0 - 0.2 || refA.currentTime > T1) refA.currentTime = T0;
  refA.play().catch(() => { }); setPlaying(true); tick();
}
function playLine(i) {
  seg = { i, s: lineS(i), e: lineE(i) };
  refA.currentTime = seg.s; refA.play().catch(() => { }); setPlaying(true); tick();
}
$('#btn-play').addEventListener('click', () => { if (!P) return; if (!refA.paused) stopRef(); else playFull(); });
$$('.speed button').forEach(b => b.addEventListener('click', () => {
  refA.playbackRate = +b.dataset.speed; $$('.speed button').forEach(x => x.setAttribute('aria-pressed', x === b));
}));
$('#verse-listen').addEventListener('click', e => { const r = e.target.closest('.wak'); if (r) playLine(+r.dataset.i); });
$('#verse-listen').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('wak')) { e.preventDefault(); playLine(+e.target.dataset.i); } });
refA.addEventListener('ended', () => { stopRef(); });

const rows = () => $$('#verse-listen .wak');
function clearKaraoke() { rows().forEach(r => { r.classList.remove('now'); $$('.h', r).forEach(h => h.style.removeProperty('--p')); }); }
function tick() {
  cancelAnimationFrame(rafId);
  const t = refA.currentTime;
  if (seg && t >= seg.e) {
    if ($('#chk-loop').checked) { refA.currentTime = seg.s; } else { stopRef(); return; }
  }
  if (!seg && t > T1) { stopRef(); return; }
  const rs = rows(); let active = -1;
  U.forEach((u, i) => {
    const hs = $$('.h', rs[i]), on = t >= gFirst(i).t0 - 0.12 && t <= gLast(i).t1 + 0.3;
    rs[i].classList.toggle('now', on);
    if (on) {
      active = i;
      u.groups.forEach((g, h) => hs[h].style.setProperty('--p', (t >= g.t0 ? clamp((t - g.t0) / Math.max(0.05, g.t1 - g.t0), 0, 1) * 100 : 0) + '%'));
    } else hs.forEach(h => h.style.removeProperty('--p'));
  });
  const dur = T1 - T0, pr = clamp((t - T0) / dur, 0, 1) * 100;
  ui.fill.style.width = pr + '%'; ui.knob.style.left = pr + '%'; ui.track.setAttribute('aria-valuenow', Math.round(pr));
  ui.time.textContent = fmtTime(Math.max(0, t - T0)) + ' / ' + fmtTime(dur);
  if (active >= 0) ui.title.textContent = 'วรรคที่ ' + thn(active + 1) + ' · ' + U[active].groups.map(g => g.text).join(' ');
  if (!refA.paused) rafId = requestAnimationFrame(tick);
}
refA.addEventListener('pause', () => { if (refA.paused) setPlaying(false); });
function seekFrom(ev) {
  const r = ui.track.getBoundingClientRect(), p = clamp((ev.clientX - r.left) / r.width, 0, 1);
  refA.currentTime = T0 + p * (T1 - T0); seg = null; tick();
}
let dragging = false;
ui.track.addEventListener('pointerdown', e => { dragging = true; ui.track.setPointerCapture(e.pointerId); seekFrom(e); });
ui.track.addEventListener('pointermove', e => { if (dragging) seekFrom(e); });
ui.track.addEventListener('pointerup', () => { dragging = false; });
ui.track.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { refA.currentTime = Math.min(T1, refA.currentTime + 2); tick(); }
  if (e.key === 'ArrowLeft') { refA.currentTime = Math.max(T0, refA.currentTime - 2); tick(); }
});

/* ---------------------------------------------------------------- reference analysis */
const refChip = $('#ref-chip');
function refState(s, msg) {
  state.ref = s; refChip.textContent = msg; refChip.className = 'chip' + (s === 'ready' ? ' ok' : s === 'error' ? ' bad' : '');
  updateRecBtn();
}
async function loadRef() {
  refState('loading', 'กำลังเตรียมเสียงต้นแบบ…');
  try {
    const url = await A.poemAudioUrl(P); if (!url) throw new Error('noaudio');
    if (!refA.src) refA.src = url;
    const r = await fetch(url); if (!r.ok) throw new Error('http ' + r.status);
    const buf = await decode(await r.arrayBuffer());
    const chs = channels(buf), spec = A.poemSpec(P);
    localRefSpec = { chs, sr: buf.sampleRate, spec, done: !worker };
    const out = await engine('ref', chs, buf.sampleRate, { spec });
    if (!out.ok) { refState('error', out.error === 'reflong' ? 'เสียงต้นแบบยาวเกิน ' + thn(window.Analyzer.MAX_REF_SEC) + ' วินาที ให้ครูแบ่งเป็นหลายบท' : 'เตรียมเสียงต้นแบบไม่สำเร็จ'); return; }
    state.refSec = out.seconds || (P.refT1 - P.refT0);
    refState('ready', 'เสียงต้นแบบพร้อมแล้ว');
  } catch (e) {
    refState('error', location.protocol === 'file:' ? 'ต้องเปิดผ่านเว็บ (https) จึงจะวิเคราะห์ได้' : 'โหลดเสียงต้นแบบไม่สำเร็จ ลองรีเฟรช');
  }
}

/* ---------------------------------------------------------------- user fields */
const inName = $('#in-name'), inRoom = $('#in-room');
inName.value = state.user.name || ''; inRoom.value = state.user.room || '';
[inName, inRoom].forEach(el => el.addEventListener('input', () => { state.user = { name: inName.value.trim(), room: inRoom.value.trim() }; store(CFG.LS_USER, state.user); updateRecBtn(); }));

/* ---------------------------------------------------------------- mic helpers */
const meterEl = $('#meter'); const NB = 22;
meterEl.innerHTML = '<i></i>'.repeat(NB);
const mbars = $$('i', meterEl);
let mic = null, meterRaf = 0;
async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('nomic');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const c = ctx(); if (c.state === 'suspended') await c.resume();
  const src = c.createMediaStreamSource(stream), an = c.createAnalyser(); an.fftSize = 2048; src.connect(an);
  mic = { stream, src, an, buf: new Float32Array(an.fftSize), db: -90 };
  const loop = () => {
    if (!mic) return;
    mic.an.getFloatTimeDomainData(mic.buf);
    let s = 0; for (let i = 0; i < mic.buf.length; i++) s += mic.buf[i] * mic.buf[i];
    const db = 10 * Math.log10(s / mic.buf.length + 1e-10); mic.db = db;
    const lv = clamp((db + 60) / 50, 0, 1), n = Math.round(lv * NB);
    mbars.forEach((b, i) => { b.classList.toggle('on', i < n); b.classList.toggle('hot', i < n && i > NB - 3); });
    meterRaf = requestAnimationFrame(loop);
  };
  loop();
  return mic;
}
function closeMic() {
  cancelAnimationFrame(meterRaf);
  if (mic) { try { mic.src.disconnect(); } catch (e) { } mic.stream.getTracks().forEach(t => t.stop()); mic = null; }
  mbars.forEach(b => b.classList.remove('on', 'hot'));
}
function setStatus(kind, msg) { const s = $('#mic-status'); s.className = 'status ' + (kind || ''); $('#mic-msg').textContent = msg; }
function micError(e) {
  const n = e && e.name;
  if (e && e.message === 'nomic') return 'เบราว์เซอร์นี้ไม่รองรับการอัดเสียง ลองใช้ Chrome หรือ Safari รุ่นใหม่ และเปิดผ่าน https';
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'ยังไม่ได้อนุญาตใช้ไมโครโฟน กดสัญลักษณ์แม่กุญแจที่แถบที่อยู่แล้วเลือก “อนุญาต”';
  if (n === 'NotFoundError') return 'ไม่พบไมโครโฟนในอุปกรณ์นี้';
  return 'เปิดไมโครโฟนไม่สำเร็จ ลองปิดแอปอื่นที่ใช้ไมค์อยู่แล้วทดสอบใหม่';
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sample(ms) { const a = []; const t = performance.now(); while (performance.now() - t < ms) { if (!mic) break; a.push(mic.db); await sleep(40); } return a; }
$('#btn-mictest').addEventListener('click', async () => {
  const btn = $('#btn-mictest'); btn.disabled = true;
  try {
    setStatus('warn', 'กำลังเปิดไมโครโฟน…'); await openMic();
    setStatus('warn', 'เงียบสักครู่ ๑ วินาที เพื่อวัดเสียงรบกวน…');
    const nz = (await sample(1300)).sort((a, b) => a - b); const noise = nz[Math.floor(nz.length / 2)];
    setStatus('warn', 'ลองพูดออกเสียงดัง ๆ ว่า “' + (U.length ? U[0].groups.map(g => g.text).join(' ') : 'สวัสดีครับ') + '”');
    const pk = (await sample(3200)).sort((a, b) => a - b); const peak = pk[Math.floor(pk.length * 0.95)];
    closeMic();
    const snr = peak - noise;
    if (peak < -48) { state.micOk = false; setStatus('bad', 'ได้ยินเสียงเบามาก ขยับเข้าใกล้ไมค์อีกนิด หรือเช็กว่าไมค์ไม่ถูกปิดเสียง'); }
    else if (peak > -4) { state.micOk = false; setStatus('warn', 'เสียงดังจนอาจแตก ถอยห่างจากไมค์อีกเล็กน้อย'); }
    else if (snr < 18) { state.micOk = true; setStatus('warn', 'มีเสียงรบกวนค่อนข้างมาก ถ้าย้ายไปที่เงียบกว่าได้ ผลจะแม่นยำขึ้น (ยังอ่านต่อได้)'); }
    else { state.micOk = true; setStatus('ok', 'ไมค์พร้อมใช้งาน เสียงชัดและเงียบพอ'); }
  } catch (e) { closeMic(); setStatus('bad', micError(e)); }
  btn.disabled = false;
});

/* ---------------------------------------------------------------- recording */
const recBtn = $('#btn-rec'), timerEl = $('#rec-timer'), hintEl = $('#rec-hint');
function updateRecBtn() {
  const busy = state.rec && state.rec.on;
  recBtn.disabled = !busy && state.ref !== 'ready';
}
function pickMime() {
  const c = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (!window.MediaRecorder) return null;
  for (const m of c) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { } }
  return '';
}
const maxRecSec = () => Math.min(300, Math.max(100, state.refSec * 2.5));
recBtn.addEventListener('click', async () => {
  if (state.rec && state.rec.on) { stopRec(); return; }
  if (!state.user.name) { toast('กรอกชื่อก่อนเริ่มอ่านนะครับ'); inName.focus(); inName.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  try {
    const m = await openMic();
    const mime = pickMime(); if (mime === null) throw new Error('nomic');
    const mr = new MediaRecorder(m.stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 }), chunks = [];
    mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = () => onRecorded(new Blob(chunks, { type: mr.mimeType || mime || 'audio/webm' }));
    state.rec = { on: true, mr, t0: performance.now() };
    mr.start(300);
    recBtn.classList.add('on'); hintEl.textContent = 'กำลังบันทึก… อ่านทั้ง ' + thn(NU) + ' วรรค แล้วแตะปุ่มเพื่อหยุด';
    $('#myrec').classList.remove('show');
    state.rec.iv = setInterval(() => {
      const s = (performance.now() - state.rec.t0) / 1000; timerEl.textContent = fmtTime(s);
      if (s > maxRecSec()) stopRec();
    }, 200);
  } catch (e) { closeMic(); toast(micError(e), 5200); }
});
function stopRec() {
  if (!state.rec || !state.rec.on) return;
  state.rec.on = false; clearInterval(state.rec.iv); state.rec.dur = (performance.now() - state.rec.t0) / 1000;
  try { state.rec.mr.stop(); } catch (e) { }
  closeMic(); recBtn.classList.remove('on'); hintEl.textContent = 'แตะปุ่มเพื่อเริ่มอ่านใหม่อีกครั้ง';
}
const STEPS = ['เตรียมเสียงที่อัด…', 'จับระดับเสียงสูงต่ำ…', 'เทียบจังหวะกับต้นแบบ…', 'ฟังท้ายวรรคทีละวรรค…', 'ให้คะแนนและเรียบเรียงคำแนะนำ…'];
let stepIv;
function overlay(on) {
  $('#analyzing').classList.toggle('show', on); clearInterval(stepIv);
  if (on) { let k = 0; $('#an-step').textContent = STEPS[0]; stepIv = setInterval(() => { k = Math.min(k + 1, STEPS.length - 1); $('#an-step').textContent = STEPS[k]; }, 900); }
}
async function onRecorded(blob) {
  if (state.rec && state.rec.dur < Math.min(8, 0.2 * state.refSec)) { toast('บันทึกสั้นเกินไป ลองอ่านให้จบทั้ง ' + thn(NU) + ' วรรค', 4500); return; }
  if (state.last && state.last.url) URL.revokeObjectURL(state.last.url);
  const url = URL.createObjectURL(blob);
  $('#my-audio').src = url; $('#myrec').classList.add('show');
  overlay(true);
  try {
    const buf = await decode(await blob.arrayBuffer());
    const res = await engine('score', channels(buf), buf.sampleRate, { opts: { weights: P.weights } });
    overlay(false);
    if (res.error) { explainError(res); return; }
    A.applyCalib(res, P.calib, P.weights);
    state.last = { res, url, blob, at: Date.now() };
    const attempt = saveAttempt(res);
    renderResult(res, attempt);
    $('.tabbar [data-go=result]').classList.add('has-dot');
    go('result');
  } catch (e) {
    overlay(false);
    toast('วิเคราะห์เสียงไม่สำเร็จ ลองอัดใหม่อีกครั้ง (' + (e && e.message ? e.message : 'ไม่ทราบสาเหตุ') + ')', 6000);
  }
}
function explainError(r) {
  const m = {
    short: 'ได้ยินเสียงอ่านเพียงประมาณ ' + thn(r.seconds || 0) + ' วินาที ลองอ่านให้จบทั้ง ' + thn(NU) + ' วรรคแล้วค่อยกดหยุด',
    long: 'บันทึกยาวเกินไป ลองอ่านเฉพาะบทนี้ให้จบแล้วกดหยุดทันที',
    nopitch: 'จับระดับเสียงไม่ได้ เสียงอาจเบาหรือมีเสียงรบกวนมาก ลองเข้าใกล้ไมค์และอ่านออกเสียงให้ชัดขึ้น',
    noref: 'เสียงต้นแบบยังไม่พร้อม ลองรอสักครู่แล้วอ่านใหม่'
  };
  toast(m[r.error] || 'วิเคราะห์ไม่สำเร็จ ลองอ่านใหม่อีกครั้ง', 6500);
}

/* ---------------------------------------------------------------- feedback text */
function grade(t) {
  if (t >= 88) return ['ไพเราะนัก', 'อ่านได้ใกล้เคียงต้นแบบมาก ทั้งทำนองและจังหวะ'];
  if (t >= 75) return ['ดีมาก', 'ทำนองและจังหวะอยู่ในเกณฑ์ดี เหลือปรับอีกเล็กน้อยก็จะไพเราะยิ่งขึ้น'];
  if (t >= 60) return ['ใกล้เคียงแล้ว', 'จับแนวทำนองได้แล้ว ลองฟังต้นแบบซ้ำแล้วปรับบางวรรค'];
  return ['ฝึกต่ออีกนิด', 'ลองฟังต้นแบบทีละวรรค อ่านตามช้า ๆ แล้วค่อยเพิ่มความเร็ว'];
}
function lineNotes(L) {
  const d = L.detail, n = [];
  if (L.complete != null && L.complete < 70) n.push([L.complete, d.durRatio < 0.5 ? 'วรรคนี้สั้นผิดปกติ อาจข้ามคำหรืออ่านไม่จบวรรค' : 'เสียงขาดหายหลายช่วงในวรรคนี้ ลองอ่านให้ครบทุกคำและต่อเนื่อง']);
  if (L.melody < 70) n.push([L.melody, d.coverage < 0.5 ? 'เสียงขาดหายหลายช่วง ลองออกเสียงให้ต่อเนื่องและดังขึ้นอีกนิด' : 'เสียงสูงต่ำยังต่างจากต้นแบบ ลองฟังแล้วตามเสียงสูงต่ำทีละคำ']);
  if (L.rhythm < 75) {
    if (d.groups > 1 && d.splitDiff > 0.1) n.push([L.rhythm, 'ช่วงก่อนเว้นจังหวะในวรรคยาวไปหน่อย ลองเว้นให้ตรงจุด ◆']);
    else if (d.groups > 1 && d.splitDiff < -0.1) n.push([L.rhythm, 'ช่วงก่อนเว้นจังหวะในวรรคสั้นไปหน่อย ลองยืดคำต้นวรรคอีกนิด']);
    else if (d.durRatio > 1.25) n.push([L.rhythm, 'วรรคนี้อ่านช้ากว่าส่วนอื่นของบท']);
    else if (d.durRatio < 0.8) n.push([L.rhythm, 'วรรคนี้อ่านเร็วกว่าส่วนอื่นของบท ลองผ่อนจังหวะลง']);
    else n.push([L.rhythm, 'จังหวะการหยุดพักระหว่างวรรคยังต่างจากต้นแบบ']);
  }
  if (L.ending < 75) {
    if (!d.endOk) n.push([L.ending, 'ท้ายวรรคเสียงเบาหรือขาดหาย ลองทอดเสียงให้ชัดจนจบวรรค']);
    else if (d.endLenRatio < 0.7) n.push([L.ending, 'ทอดเสียงท้ายวรรคให้ยาวขึ้นอีกนิด']);
    else if (d.endLenRatio > 1.45) n.push([L.ending, 'ลากเสียงท้ายวรรคนานไปหน่อย']);
    else if (d.endSlopeDiff > 3) n.push([L.ending, 'ปลายเสียงท้ายวรรคยกสูงกว่าต้นแบบ ลองให้เสียงทอดลง']);
    else if (d.endSlopeDiff < -3) n.push([L.ending, 'ปลายเสียงท้ายวรรคตกลงมากกว่าต้นแบบ ลองรักษาระดับเสียงไว้']);
    else n.push([L.ending, 'การทอดเสียงท้ายวรรคยังต่างจากต้นแบบเล็กน้อย']);
  }
  n.sort((a, b) => a[0] - b[0]);
  return n.slice(0, 2).map(x => x[1]);
}
function summaryHtml(res) {
  const dims = [['ทำนอง', res.melody], ['จังหวะ', res.rhythm], ['การทอดเสียงท้ายวรรค', res.ending]];
  if (res.complete != null) dims.push(['ความครบถ้วน', res.complete]);
  const s = dims.slice().sort((a, b) => b[1] - a[1]), best = s[0], worst = s[s.length - 1];
  const weak = res.lines.slice().sort((a, b) => a.total - b.total).filter(l => l.total < 75).slice(0, 3).map(l => thn(l.idx + 1));
  const out = [];
  out.push('รอบนี้<b>' + best[0] + '</b>เป็นจุดเด่น (' + thn(best[1]) + ' คะแนน)' + (worst[1] < 80 ? ' ส่วน<b>' + worst[0] + '</b>ยังพัฒนาได้อีก (' + thn(worst[1]) + ' คะแนน)' : ' และทุกด้านอยู่ในเกณฑ์ดี'));
  const tp = Math.round(Math.abs(res.tempo - 1) * 100);
  if (res.tempo > 1.18) out.push('โดยรวมอ่านช้ากว่าต้นแบบประมาณ ' + thn(tp) + '% การอ่านช้าไม่ผิด แต่ลองเร่งให้ลื่นไหลขึ้นเมื่อจำทำนองได้แล้ว');
  else if (res.tempo < 0.85) out.push('โดยรวมอ่านเร็วกว่าต้นแบบประมาณ ' + thn(tp) + '% ลองผ่อนจังหวะและทอดเสียงท้ายวรรคให้นานขึ้น');
  else out.push('ความเร็วโดยรวมใกล้เคียงต้นแบบ');
  out.push(weak.length ? 'ควรฟังต้นแบบ<b>วรรคที่ ' + weak.join(' ') + '</b>ซ้ำ แล้วอ่านตามช้า ๆ ทีละวรรคก่อนรวมทั้งบท' : 'ทุกวรรคอยู่ในเกณฑ์ดี ลองอ่านอีกรอบเพื่อรักษาความสม่ำเสมอ');
  return out.map(x => '<p>' + x + '</p>').join('');
}

/* ---------------------------------------------------------------- charts */
function segPath(xs, ys, x, y) {
  let d = '', pen = false;
  for (let i = 0; i < xs.length; i++) {
    if (ys[i] == null) { pen = false; continue; }
    d += (pen ? 'L' : 'M') + x(xs[i]).toFixed(1) + ' ' + y(ys[i]).toFixed(1); pen = true;
  }
  return d;
}
function chartSvg(xsAll, refY, lrnY, o) {
  const W = o.w, H = o.h, pl = 6, pr = 6, pt = o.top || 8, pb = 8;
  const vals = refY.concat(lrnY).filter(v => v != null);
  let lo = Math.min.apply(null, vals.concat([-2])) - 1, hi = Math.max.apply(null, vals.concat([2])) + 1;
  if (hi - lo < 9) { const m = (hi + lo) / 2; lo = m - 4.5; hi = m + 4.5; }
  const tmax = xsAll[xsAll.length - 1] || 1;
  const x = t => pl + (W - pl - pr) * t / tmax, y = v => pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo));
  let g = '';
  const showNo = (o.bands || []).length <= 16;
  (o.bands || []).forEach((b, i) => { if (i % 2 === 0) g += '<rect x="' + x(b[0]).toFixed(1) + '" y="0" width="' + (x(b[1]) - x(b[0])).toFixed(1) + '" height="' + H + '" fill="#f4e7c4" opacity=".55"/>'; if (showNo) g += '<text x="' + ((x(b[0]) + x(b[1])) / 2).toFixed(1) + '" y="11" text-anchor="middle" font-size="9.5" fill="#7a7c92" font-family="Sarabun,sans-serif">' + thn(i + 1) + '</text>'; });
  g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '" stroke="#b98618" stroke-width=".8" stroke-dasharray="3 4" opacity=".7"/>';
  (o.marks || []).forEach(m => { g += '<line x1="' + x(m).toFixed(1) + '" x2="' + x(m).toFixed(1) + '" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#dfa82a" stroke-width="1.2" stroke-dasharray="1.5 3"/>'; });
  g += '<path d="' + segPath(xsAll, refY, x, y) + '" fill="none" stroke="#13235a" stroke-width="' + (o.sw || 3) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  g += '<path d="' + segPath(xsAll, lrnY, x, y) + '" fill="none" stroke="#c2412d" stroke-width="' + ((o.sw || 3) - 0.8) + '" stroke-linecap="round" stroke-linejoin="round"/>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label) + '">' + g + '</svg>';
}
function lineChart(L) {
  const G = U[L.idx].groups, base = G[0].t0, marks = [];
  for (let g = 1; g < G.length; g++) marks.push((G[g - 1].t1 + G[g].t0) / 2 - base);
  return chartSvg(L.chart.t, L.chart.r, L.chart.l, { w: 320, h: 92, marks, label: 'กราฟเทียบเสียงสูงต่ำวรรคที่ ' + (L.idx + 1) + ' เส้นกรมท่าคือต้นแบบ เส้นสีชาดคือเสียงของเรา' });
}
function overviewChart(res) {
  const xs = [], r = [], l = [], bands = [], base = gFirst(0).t0;
  res.lines.forEach(L => {
    const off = gFirst(L.idx).t0 - base;
    L.chart.t.forEach((t, k) => { xs.push(+(t + off).toFixed(2)); r.push(L.chart.r[k]); l.push(L.chart.l[k]); });
    bands.push([off, off + (gLast(L.idx).t1 - gFirst(L.idx).t0)]);
  });
  return chartSvg(xs, r, l, { w: 340, h: 116, top: 16, sw: 2.2, bands, label: 'กราฟเทียบเสียงสูงต่ำตลอดทั้งบท' });
}
function sparkSvg(vals) {
  const W = 320, H = 90, pl = 14, pr = 14, pt = 10, pb = 14;
  if (vals.length < 2) return '';
  const x = i => pl + (W - pl - pr) * i / (vals.length - 1), y = v => pt + (H - pt - pb) * (1 - v / 100);
  let d = '', dots = '';
  vals.forEach((v, i) => { d += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); dots += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="4" fill="#efc04a" stroke="#13235a" stroke-width="1.5"/>'; });
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="แนวโน้มคะแนนรวมแต่ละครั้ง"><line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(75) + '" y2="' + y(75) + '" stroke="#b98618" stroke-width=".8" stroke-dasharray="3 4"/><path d="' + d + '" fill="none" stroke="#13235a" stroke-width="2.5" stroke-linejoin="round"/>' + dots + '</svg>';
}

/* ---------------------------------------------------------------- result view */
let learnerA = null, learnerStop = 0;
function playLearner(L) {
  if (!state.last || !state.last.url) return;
  refA.pause(); setPlaying(false);
  if (!learnerA) learnerA = new Audio(state.last.url); else if (learnerA.src !== state.last.url) learnerA.src = state.last.url;
  const s = Math.max(0, L.learnerStart - 0.15), e = L.learnerEnd + 0.3;
  learnerA.currentTime = s; learnerA.play().catch(() => { });
  clearInterval(learnerStop); learnerStop = setInterval(() => { if (learnerA.currentTime >= e || learnerA.paused) { learnerA.pause(); clearInterval(learnerStop); } }, 60);
}
function playRefSegment(i) {
  if (learnerA) learnerA.pause();
  seg = { i, s: lineS(i), e: lineE(i) }; refA.currentTime = seg.s; refA.play().catch(() => { });
  clearInterval(learnerStop); const iv = setInterval(() => { if (!seg || refA.currentTime >= seg.e || refA.paused) { refA.pause(); clearInterval(iv); seg = null; } }, 60);
}
function badgeCls(v) { return v >= 80 ? 'hi' : v < 60 ? 'lo' : ''; }
function countUp(el, to, ms) { const t0 = performance.now(); const f = now => { const p = clamp((now - t0) / ms, 0, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = thn(Math.round(to * e)); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
function renderResult(res, attempt) {
  const [g, sub] = grade(res.total), host = $('#result-body'), C = 2 * Math.PI * 78;
  const dim = (name, v, hint) => '<div class="dim"><div class="row"><span>' + name + '</span><span>' + thn(v) + '</span></div><div class="bar"><i data-w="' + v + '"></i></div><div class="hint">' + hint + '</div></div>';
  const tempoTxt = res.tempo > 1.18 ? 'อ่านช้ากว่าต้นแบบ ' + thn(Math.round((res.tempo - 1) * 100)) + '%' : res.tempo < 0.85 ? 'อ่านเร็วกว่าต้นแบบ ' + thn(Math.round((1 - res.tempo) * 100)) + '%' : 'ความเร็วใกล้เคียงต้นแบบ';
  const q = res.snr >= 30 ? ['คุณภาพเสียงดี', 'ok'] : res.snr >= 18 ? ['มีเสียงรบกวนเล็กน้อย', ''] : ['เสียงรบกวนมาก ผลอาจคลาดเคลื่อน', 'bad'];
  const pronOn = (P.pronWeight || 0) > 0;
  host.innerHTML =
    '<div class="card"><div class="score-hero">' +
    '<div class="ring"><svg viewBox="0 0 176 176"><circle class="bg" cx="88" cy="88" r="78" fill="none" stroke-width="12"/><circle class="fg" id="ring-fg" cx="88" cy="88" r="78" fill="none" stroke-width="12" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + C.toFixed(1) + '"/></svg><div class="num"><span id="score-num">๐</span><small>จาก ๑๐๐</small></div></div>' +
    '<div><p class="grade">' + (res.total >= 75 ? '<img src="assets/done.png" width="40" height="40" alt="" style="vertical-align:-8px;margin-right:6px">' : '') + g + '</p><p class="note" style="margin:2px 0 10px">' + sub + (pronOn ? '<br><small>คะแนนทำนอง (อัตโนมัติ) · อักขรวิธี: รอครูยืนยัน</small>' : '') + '</p>' +
    '<div class="chips" style="justify-content:flex-start;margin-bottom:12px"><span class="chip">' + tempoTxt + '</span><span class="chip ' + q[1] + '">' + q[0] + '</span><span class="chip">ยาว ' + thn(Math.round(res.seconds)) + ' วินาที</span></div>' +
    '<div class="dims">' + dim('ทำนอง (เสียงสูงต่ำ)', res.melody, 'เส้นเสียงสูงต่ำใกล้ต้นแบบแค่ไหน') + dim('จังหวะ', res.rhythm, 'ความยาวแต่ละวรรค จุดเว้น และการหยุดพัก') + dim('การทอดเสียงท้ายวรรค', res.ending, 'ความยาวและปลายเสียงท้ายวรรค') +
    (res.complete != null ? dim('ความครบถ้วน', res.complete, 'อ่านครบทุกวรรค ไม่ข้ามหรือขาดหาย') : '') + '</div></div></div></div>' +
    '<div class="card sum"><h3>คำแนะนำจากครู</h3>' + summaryHtml(res) + '</div>' +
    '<div class="card"><h3>เส้นเสียงสูงต่ำตลอดบท</h3><div class="chartbox">' + overviewChart(res) + '</div>' +
    '<div class="legend"><span><i style="background:#13235a"></i>ต้นแบบ</span><span><i style="background:#c2412d"></i>เสียงของเรา</span><span><i style="background:repeating-linear-gradient(90deg,#b98618 0 4px,transparent 4px 8px);height:2px"></i>ระดับเสียงกลางของผู้อ่าน</span></div>' +
    '<p class="note" style="margin:8px 0 0">ระบบปรับระดับเสียงให้เทียบกันตามช่วงเสียงของแต่ละคน ผู้ชายหรือผู้หญิงจึงเทียบกับต้นแบบได้อย่างเป็นธรรม</p></div>' +
    '<h2 class="sec" style="font-size:19px"><span class="no"><span>' + thn(NU) + '</span></span>รายวรรค</h2><div id="lines"></div>' +
    '<div class="card"><p class="note" id="save-note" style="margin:0 0 12px"></p><div class="acts"><button class="btn gold" data-go="read"><svg><use href="#i-mic"/></svg>อ่านใหม่อีกครั้ง</button><button class="btn ghost" data-go="listen"><svg><use href="#i-ear"/></svg>กลับไปฟังต้นแบบ</button></div></div>';
  const lines = $('#lines', host);
  res.lines.forEach(L => {
    const notes = lineNotes(L), c = document.createElement('div'), u = U[L.idx];
    c.className = 'card lcard reveal';
    c.innerHTML = '<div class="hd"><span class="no"><span>' + thn(L.idx + 1) + '</span></span><div class="t">' + unitText(u, ' <span class="pause" style="margin:0 6px;width:7px;height:7px"></span> ') + (u.role ? '<small>วรรค' + esc(u.role) + '</small>' : '') + '</div><span class="badge ' + badgeCls(L.total) + '">' + thn(L.total) + '</span></div>' +
      '<div class="chartbox" style="margin-top:10px">' + lineChart(L) + '</div>' +
      '<div class="mini3"><div>ทำนอง<b>' + thn(L.melody) + '</b><div class="bar"><i style="width:' + L.melody + '%"></i></div></div><div>จังหวะ<b>' + thn(L.rhythm) + '</b><div class="bar"><i style="width:' + L.rhythm + '%"></i></div></div><div>ท้ายวรรค<b>' + thn(L.ending) + '</b><div class="bar"><i style="width:' + L.ending + '%"></i></div></div></div>' +
      '<ul>' + (notes.length ? notes.map(n => '<li>' + n + '</li>').join('') : '<li>วรรคนี้ใกล้เคียงต้นแบบมาก</li>') + '</ul>' +
      '<div class="acts"><button class="btn small ghost" data-ref="' + L.idx + '"><svg><use href="#i-play"/></svg>ต้นแบบ</button><button class="btn small" data-me="' + L.idx + '"><svg><use href="#i-play"/></svg>เสียงของเรา</button></div>';
    lines.appendChild(c);
  });
  $$('[data-ref]', host).forEach(b => b.addEventListener('click', () => playRefSegment(+b.dataset.ref)));
  $$('[data-me]', host).forEach(b => b.addEventListener('click', () => playLearner(res.lines[+b.dataset.me])));
  $('#result-empty').hidden = true; host.hidden = false;
  requestAnimationFrame(() => {
    countUp($('#score-num'), res.total, 1500);
    $('#ring-fg').style.strokeDashoffset = (C * (1 - res.total / 100)).toFixed(1);
    $$('.dim .bar i', host).forEach(i => i.style.width = i.dataset.w + '%');
  });
  updateSaveNote(attempt);
  observeReveal();
}
function updateSaveNote(a) {
  const el = $('#save-note'); if (!el) return;
  if (!a) { el.textContent = ''; return; }
  el.textContent = a.synced ? 'บันทึกผลเข้าฐานข้อมูลของครูเรียบร้อยแล้ว' : (A.fb.on ? 'กำลังบันทึกผลเข้าฐานข้อมูล…' : 'บันทึกผลไว้ในเครื่องนี้แล้ว (ยังไม่ได้เชื่อมฐานข้อมูล)');
}

/* ---------------------------------------------------------------- reveal */
let io = null;
function observeReveal() {
  if (!('IntersectionObserver' in window)) { $$('.reveal').forEach(e => e.classList.add('in')); return; }
  if (!io) io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal:not(.in)').forEach(e => io.observe(e));
}

/* ---------------------------------------------------------------- attempts store + history */
function saveAttempt(res) {
  const a = {
    id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(),
    poemId: P.id, poemTitle: P.title,
    name: state.user.name, room: state.user.room, total: res.total, melody: res.melody, rhythm: res.rhythm, ending: res.ending, complete: res.complete,
    tempo: res.tempo, seconds: res.seconds, snr: res.snr, offsetSt: res.offsetSt,
    lines: res.lines.map(l => ({ idx: l.idx, m: l.melody, r: l.rhythm, e: l.ending, c: l.complete, t: l.total, s: l.learnerStart, en: l.learnerEnd })), synced: false
  };
  state.attempts.unshift(a); state.attempts = state.attempts.slice(0, 80); store(CFG.LS_KEY, state.attempts);
  if (CFG.GAS_URL && state.last && state.last.blob && state.last.blob.size <= 3 * 1024 * 1024) A.queuePut(a.id, { blob: state.last.blob, poemId: P.id, room: a.room, name: a.name }).catch(() => { });
  syncPending();
  return a;
}
function renderHistory() {
  const list = $('#hist-list'), arr = state.attempts.slice();
  $('#hist-empty').hidden = arr.length > 0;
  const mine = arr.filter(a => a.poemId === (P && P.id));
  const ch = $('#hist-chart'); ch.hidden = mine.length < 2;
  if (mine.length >= 2) ch.innerHTML = sparkSvg(mine.slice(0, 14).reverse().map(a => a.total));
  list.innerHTML = arr.map(a => '<li><span class="sc">' + thn(a.total) + '</span><span class="meta"><b>' + esc(a.name || 'ไม่ระบุชื่อ') + (a.room ? ' · ' + esc(a.room) : '') + '</b>' + (a.poemTitle ? esc(a.poemTitle) + '<br>' : '') + fmtDate(a.ts) + ' · ทำนอง ' + thn(a.melody) + ' · จังหวะ ' + thn(a.rhythm) + ' · ท้ายวรรค ' + thn(a.ending) + (a.complete != null ? ' · ครบถ้วน ' + thn(a.complete) : '') + (a.final != null ? '<br><b>คะแนนสุดท้าย (ครูยืนยันแล้ว) ' + thn(a.final) + '</b>' : a.pronStatus && a.pronStatus !== 'confirmed' && a.pronStatus !== 'none' ? '<br>อักขรวิธี: รอครูยืนยัน' : '') + '</span><span class="sync">' + (a.synced ? 'ซิงก์แล้ว' : 'ในเครื่อง') + '</span></li>').join('');
  $('#hist-sync').textContent = A.fb.on ? (A.fb.user ? 'เชื่อมฐานข้อมูลแล้ว ครูดูผลของเราได้ ส่วนประวัติผูกกับเครื่องนี้' : 'กำลังเชื่อมฐานข้อมูล…') : 'ยังไม่ได้เชื่อมฐานข้อมูล ผลเก็บไว้ในเครื่องนี้';
}
async function syncPending() {
  const fb = A.fb;
  if (!fb.on || !fb.user || !fb.user.isAnonymous) return;
  for (const a of state.attempts.filter(x => !x.synced && !x.legacy)) {
    try {
      await fb.db.collection(CFG.COLLECTION).doc(a.id).set(A.attemptDoc(a));
      a.synced = true; store(CFG.LS_KEY, state.attempts);
      if (state.last && state.last.at && Math.abs(a.ts - state.last.at) < 60000) updateSaveNote(a);
    } catch (e) { break; }
  }
  A.flushUploads();
  if (state.tab === 'history') renderHistory();
}
async function loadRemote() {
  const fb = A.fb;
  try {
    const qs = await fb.db.collection(CFG.COLLECTION).where('uid', '==', fb.user.uid).get();
    const have = new Set(state.attempts.map(a => a.id));
    qs.forEach(d => { const x0 = d.data(), mine = state.attempts.find(a => a.id === d.id); if (mine) { mine.final = x0.final; mine.pronStatus = x0.pron && x0.pron.status; mine.hasAudio = !!x0.audio; } if (!have.has(d.id)) { const x = d.data(), au = x.auto || x; state.attempts.push({ id: d.id, ts: x.clientAt || Date.now(), poemId: x.poemId, poemTitle: x.poemTitle, name: x.name, room: x.room, total: au.total, melody: au.melody, rhythm: au.rhythm, ending: au.ending, complete: au.complete, tempo: au.tempo, seconds: au.seconds, lines: x.lines || [], final: x.final, pronStatus: x.pron && x.pron.status, synced: true }); } });
    state.attempts.sort((a, b) => b.ts - a.ts); state.attempts = state.attempts.slice(0, 80); store(CFG.LS_KEY, state.attempts);
    if (state.tab === 'history') renderHistory();
  } catch (e) { }
}
A.fb.listeners.push(() => { loadRemote(); syncPending(); });

/* ---------------------------------------------------------------- install (add to home screen) */
let deferred = null;
const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#install-card').hidden = false; $('#install-btn').hidden = false; });
$('#install-btn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); try { await deferred.userChoice; } catch (e) { } deferred = null; $('#install-card').hidden = true; });
window.addEventListener('appinstalled', () => { $('#install-card').hidden = true; toast('ติดตั้งแล้ว เปิดจากไอคอนบนหน้าจอโฮมได้เลย'); });
if (!standalone && /iphone|ipad|ipod/i.test(navigator.userAgent)) { $('#install-card').hidden = false; $('#ios-tip').hidden = false; }
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });

/* ---------------------------------------------------------------- poem setup */
function applyPoem(p, index) {
  P = p; U = p.units; NU = U.length; state.poem = p;
  const F = Forms.get(p.form);
  $('#poem-title').textContent = p.title + (F.name && p.form !== 'custom' ? ' · ' + F.name : '');
  $('#n-units').textContent = thn(NU);
  $('#poem-form-ic').src = 'assets/form-' + (F.icon || 'kap') + '.png';
  if (F.howto) { $('#howto-h').textContent = F.name + ' อ่านอย่างไร'; $('#howto-p').textContent = F.howto; }
  else $('#howto-h').parentNode.hidden = true;
  const pub = (index || []).filter(x => x.status !== 'draft');
  if (pub.length > 1) {
    const sel = $('#poem-pick');
    sel.innerHTML = pub.map(x => '<option value="' + esc(x.id) + '"' + (x.id === p.id ? ' selected' : '') + '>' + esc(x.title) + (x.level ? ' (' + esc(x.level) + ')' : '') + '</option>').join('');
    sel.onchange = () => { const q = new URLSearchParams(location.search); q.set('poem', sel.value); location.search = q.toString(); };
    $('#poem-pick-wrap').hidden = false;
  }
  T0 = lineS(0); T1 = gLast(NU - 1).t1 + 0.25;
  $('#tr-ticks').innerHTML = U.map((u, i) => '<i class="tick" style="left:' + (100 * (gFirst(i).t0 - T0) / (T1 - T0)) + '%"></i>').join('');
  ui.time.textContent = fmtTime(0) + ' / ' + fmtTime(T1 - T0);
  renderVerse($('#verse-listen'), true);
  renderVerse($('#verse-read'), false);
  if (p.audio && p.audio.url) refA.src = p.audio.url;
  if (CFG.GAS_URL) { const lead = $('#view-read .lead'); if (lead) lead.innerHTML = 'เตรียมตัว ทดสอบไมค์ แล้วอ่านทั้ง <span id="n-units">' + thn(NU) + '</span> วรรคให้จบในครั้งเดียว ระบบให้คะแนนในเครื่องของเรา และส่งเสียงที่อ่านให้ครูฟังย้อนหลัง (เก็บแบบส่วนตัวใน Google Drive ของครู และลบตามกำหนด)'; }
}

/* ---------------------------------------------------------------- boot */
$('#brand-t1').textContent = CFG.SYSTEM_NAME; $('#brand-t2').textContent = CFG.SYSTEM_SUB;
window.addEventListener('DOMContentLoaded', A.initFirebase);
if (document.readyState !== 'loading') A.initFirebase();
go(location.hash.slice(1) || 'listen', true);
observeReveal();
(async () => {
  const id = new URLSearchParams(location.search).get('poem') || CFG.DEFAULT_POEM;
  try {
    const { poem, index } = await A.loadPoem(id, { preview: new URLSearchParams(location.search).get('preview') === '1' });
    applyPoem(poem, index);
    loadRef();
  } catch (e) {
    refState('error', location.protocol === 'file:' ? 'ต้องเปิดผ่านเว็บ (https) จึงจะโหลดบทอ่านได้' : 'โหลดบทอ่านไม่สำเร็จ');
    $('#poem-title').textContent = 'โหลดบทอ่านไม่สำเร็จ (' + (e.message || e) + ')';
  }
})();
A.engine = engine; A.decode = decode; A.channels = channels;
})();
