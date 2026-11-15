/* แบ่งวรรค/ช่วงจังหวะอัตโนมัติจากเสียงต้นแบบ (PLAN ข้อ 6.3)
   Analyzer.segment(chs, sr, shape, opts)
     shape = [จำนวนช่วงของแต่ละวรรค]  เช่น [2,2,2,2,2,2,2,2]
     opts  = { syl:[[พยางค์ของแต่ละช่วง]], t0?, t1? }   (syl ไม่ใส่ = ถือว่าเท่ากัน)
   คืน { ok, t0, t1, units:[{groups:[[t0,t1],…]}], review:[ดัชนีวรรคที่ควรตรวจ], boundaries:[{t, kind, strength, weak}] } */
(function (A) {
  'use strict';
  var U = A._, FS = U.FS;

  function smooth(a, r) {
    var n = a.length, o = new Float32Array(n), s = 0, c = 0, i;
    for (i = 0; i < n + r; i++) {
      if (i < n) { s += a[i]; c++; }
      if (i - 2 * r - 1 >= 0) { s -= a[i - 2 * r - 1]; c--; }
      var m = i - r; if (m >= 0 && m < n) o[m] = s / c;
    }
    return o;
  }

  function segment(chs, sr, shape, opts) {
    opts = opts || {};
    var an = U.analyzeSignal(U.toMono8k(chs, sr)), n = an.n, i, j, k;
    var rg = U.activeRange(an.db, an.p95 - 30), a = rg[0], b = rg[1];
    if (opts.t0 != null) a = Math.round(opts.t0 / FS); if (opts.t1 != null) b = Math.round(opts.t1 / FS);
    if (a < 0 || b <= a) return { ok: false, error: 'nosound' };
    var sdb = smooth(an.db, 3), thr = an.p95 - 24;
    // ตัดเสียงนำ/เสียงท้ายที่แยกห่างจากตัวบท (เช่น เสียงประกาศชื่อเรื่อง) : ช่วงสั้นที่คั่นด้วยความเงียบ ≥ 1.2 วิ
    var trimmed = [];
    if (opts.t0 == null || opts.t1 == null) {
      for (var pass = 0; pass < 3; pass++) {
        var gaps = [], q0 = -1;
        for (i = a; i <= b; i++) { if (sdb[i] < thr) { if (q0 < 0) q0 = i; } else if (q0 >= 0) { if ((i - q0) * FS >= 1.2) gaps.push([q0, i]); q0 = -1; } }
        if (!gaps.length) break;
        var tot0 = b - a, ch = false, g0 = gaps[0], g1 = gaps[gaps.length - 1];
        if (opts.t0 == null && (g0[0] - a) * FS < 3 && (g0[0] - a) < 0.08 * tot0) { trimmed.push([+(a * FS).toFixed(2), +(g0[0] * FS).toFixed(2)]); a = g0[1]; ch = true; }
        else if (opts.t1 == null && (b - g1[1]) * FS < 3 && (b - g1[1]) < 0.08 * tot0) { trimmed.push([+(g1[1] * FS).toFixed(2), +(b * FS).toFixed(2)]); b = g1[0]; ch = true; }
        if (!ch) break;
      }
    }
    // ---- เป้าหมาย: ลำดับช่วง (group) ทั้งหมด พร้อมน้ำหนักความยาวที่คาด
    var G = [], isUnitEnd = [];
    shape.forEach(function (ng, u) {
      for (var g = 0; g < ng; g++) {
        var s = opts.syl && opts.syl[u] && opts.syl[u][g] ? opts.syl[u][g] : 3;
        G.push({ u: u, g: g, w: s + (g === ng - 1 ? 1.2 : 0) });   // ท้ายวรรคมักทอดเสียงยาวกว่า
        isUnitEnd.push(g === ng - 1);
      }
    });
    var NG = G.length, K = NG - 1;
    // ---- ผู้สมัครจุดตัด: ช่วงเสียงเบา/เงียบ + หุบพลังงาน
    var cands = [];
    i = a + 10;
    while (i < b - 10) {
      if (sdb[i] < thr) {
        j = i; while (j < b && sdb[j] < thr) j++;
        var mn = 0; for (k = i; k < j; k++) mn = Math.min(mn, sdb[k] - thr);
        var uv = 0; for (k = i; k < j; k++) uv += an.voiced[k] ? 0 : 1;
        cands.push({ s: i, e: j - 1, str: (j - i) * FS * 2.2 + Math.min(12, -mn) * 0.05 + uv * FS });
        i = j;
      } else i++;
    }
    for (i = a + 12; i < b - 12; i++) {
      var v = sdb[i], isMin = true;
      for (k = i - 12; k <= i + 12; k++) if (sdb[k] < v) { isMin = false; break; }
      if (!isMin || v < thr) continue;
      var ml = -1e9, mr = -1e9;
      for (k = i - 30; k < i; k++) if (k >= a) ml = Math.max(ml, sdb[k]);
      for (k = i + 1; k <= i + 30; k++) if (k <= b) mr = Math.max(mr, sdb[k]);
      var depth = Math.min(ml, mr) - v;
      if (depth < 3) continue;
      var uv2 = 0; for (k = i - 4; k <= i + 4; k++) uv2 += an.voiced[k] ? 0 : 1;
      cands.push({ s: i, e: i, str: Math.min(15, depth) * 0.03 + uv2 * FS * 0.6 });
    }
    cands.sort(function (p, q) { return p.s - q.s; });
    var C = cands.length, Ltot = b - a, Wt = 0;
    G.forEach(function (x) { Wt += x.w; });
    var flagged = {};
    var bounds = [];
    if (C >= K && K > 0) {
      // ---- DP เลือกจุดตัด K จุดตามลำดับเวลา
      var mid = cands.map(function (c) { return (c.s + c.e) / 2; });
      var expLen = G.map(function (x) { return Ltot * x.w / Wt; });
      var segCost = function (len, gi) { var r = Math.log(Math.max(len, 3) / expLen[gi]); return 1.1 * r * r; };
      var INF = 1e18, D = [], BP = [];
      for (k = 0; k < K; k++) { D.push(new Float64Array(C).fill(INF)); BP.push(new Int32Array(C).fill(-1)); }
      var bcost = function (c, kk) { var s = cands[c].str * (isUnitEnd[kk] ? 1.6 : 1); return -s; };
      for (var c = 0; c < C; c++) D[0][c] = segCost(cands[c].s - a, 0) + bcost(c, 0);
      for (k = 1; k < K; k++) {
        for (c = k; c < C; c++) {
          var best = INF, bi = -1;
          for (var p = k - 1; p < c; p++) {
            if (D[k - 1][p] >= INF) continue;
            var t = D[k - 1][p] + segCost(cands[c].s - cands[p].e, k);
            if (t < best) { best = t; bi = p; }
          }
          if (bi >= 0) { D[k][c] = best + bcost(c, k); BP[k][c] = bi; }
        }
      }
      var bc = -1, bv = INF;
      for (c = 0; c < C; c++) { var tt = D[K - 1][c] + segCost(b - cands[c].e, K); if (tt < bv) { bv = tt; bc = c; } }
      var pick = new Array(K);
      for (k = K - 1; k >= 0; k--) { pick[k] = bc; bc = BP[k][bc]; }
      for (k = 0; k < K; k++) bounds.push(cands[pick[k]]);
    } else if (K > 0) {
      // ---- ทางสำรอง: แบ่งตามสัดส่วนพยางค์ แล้วทำเครื่องหมายให้ตรวจทั้งหมด
      var acc = 0;
      for (k = 0; k < K; k++) { acc += G[k].w; var f = Math.round(a + Ltot * acc / Wt); bounds.push({ s: f, e: f, str: 0 }); }
      G.forEach(function (x) { flagged[x.u] = 1; });
    }
    // ---- ประกอบช่วง: ตัดขอบให้ตรงจุดเริ่ม/จบเสียงจริง
    var segs = [], st = a;
    for (k = 0; k <= K; k++) {
      var en = k < K ? bounds[k].s : b, ns = k < K ? bounds[k].e + 1 : b;
      var s0 = st, s1 = en;
      while (s0 < s1 - 5 && sdb[s0] < thr) s0++;
      while (s1 > s0 + 5 && sdb[s1] < thr) s1--;
      segs.push([+(s0 * FS).toFixed(2), +(s1 * FS).toFixed(2)]);
      st = ns;
    }
    var units = shape.map(function () { return { groups: [] }; });
    G.forEach(function (x, gi) { units[x.u].groups.push(segs[gi]); });
    var bInfo = bounds.map(function (bd, kk) {
      var weak = bd.str < (isUnitEnd[kk] ? 0.35 : 0.12);
      if (weak) flagged[G[kk].u] = flagged[G[kk + 1].u] = 1;
      return { t: +(((bd.s + bd.e) / 2) * FS).toFixed(2), kind: isUnitEnd[kk] ? 'unit' : 'group', strength: +bd.str.toFixed(2), weak: weak };
    });
    return {
      ok: true, t0: +Math.max(0, a * FS - 0.08).toFixed(2), t1: +(b * FS + 0.08).toFixed(2), units: units,
      review: Object.keys(flagged).map(Number).sort(function (p, q) { return p - q; }), boundaries: bInfo, fallback: !(C >= K), trimmed: trimmed
    };
  }
  A.segment = segment;
})(typeof Analyzer !== 'undefined' ? Analyzer : (typeof self !== 'undefined' ? self.Analyzer : require('./analyzer.js')));
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof Analyzer !== 'undefined' ? Analyzer : require('./analyzer.js'));
