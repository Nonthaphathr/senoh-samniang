
const Analyzer = (function () {
  'use strict';
  var SR = 8000, HOP = 80, W = 256, TAUMIN = 13, TAUMAX = 115, PAD = (W + TAUMAX) >> 1;
  var FS = HOP / SR; // 0.01 s per frame
  var REF_T0 = 3.30, REF_T1 = 44.50;
  var LINES = [
    { a: [3.38, 5.25], b: [5.54, 7.90] },
    { a: [8.42, 10.74], b: [11.15, 13.94] },
    { a: [14.47, 16.30], b: [16.45, 18.64] },
    { a: [19.01, 21.16], b: [21.44, 24.04] },
    { a: [24.75, 26.54], b: [26.82, 28.97] },
    { a: [29.38, 31.28], b: [31.68, 34.40] },
    { a: [34.86, 36.30], b: [36.62, 39.09] },
    { a: [39.38, 41.49], b: [41.79, 44.42] }
  ];
  var ref = null;

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function gauss(err, tol) { return Math.exp(-(err / tol) * (err / tol)); }

  function toMono8k(chs, sr) {
    var len = chs[0].length, mono = new Float32Array(len), c, i;
    for (c = 0; c < chs.length; c++) { var ch = chs[c]; for (i = 0; i < len; i++) mono[i] += ch[i] / chs.length; }
    var out;
    if (sr === SR) { out = mono; } else {
      var ratio = sr / SR, n = Math.floor(len / ratio);
      var cum = new Float64Array(len + 1);
      for (i = 0; i < len; i++) cum[i + 1] = cum[i] + mono[i];
      var at = function (p) { var k = Math.floor(p); if (k >= len) return cum[len]; var f = p - k; return cum[k] + (cum[k + 1] - cum[k]) * f; };
      out = new Float32Array(n);
      for (i = 0; i < n; i++) out[i] = (at((i + 1) * ratio) - at(i * ratio)) / ratio;
    }
    // high-pass ~60 Hz to drop rumble / DC
    var y = new Float32Array(out.length), px = 0, py = 0;
    for (i = 0; i < out.length; i++) { var xv = out[i]; py = xv - px + 0.95 * py; px = xv; y[i] = py; }
    return y;
  }

  function median(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }

  function analyzeSignal(x) {
    var n = Math.floor(x.length / HOP), i, j, tau;
    var xp = new Float32Array(PAD + x.length + W + TAUMAX + 2); xp.set(x, PAD);
    var db = new Float32Array(n), f0 = new Float32Array(n), ap = new Float32Array(n);
    for (i = 0; i < n; i++) {
      var c = i * HOP, s = 0, k = 0, lo = Math.max(0, c - 80), hi = Math.min(x.length, c + 80);
      for (j = lo; j < hi; j++) { s += x[j] * x[j]; k++; }
      db[i] = 10 * Math.log10(s / Math.max(k, 1) + 1e-10); ap[i] = 1;
    }
    var d = new Float32Array(TAUMAX + 1), cm = new Float32Array(TAUMAX + 1), cand = new Array(n);
    for (i = 0; i < n; i++) {
      if (db[i] < -66) continue;
      var o = i * HOP, run = 0; cm[0] = 1;
      for (tau = 1; tau <= TAUMAX; tau++) {
        var ss = 0;
        for (j = 0; j < W; j++) { var dl = xp[o + j] - xp[o + j + tau]; ss += dl * dl; }
        d[tau] = ss; run += ss; cm[tau] = run > 0 ? ss * tau / run : 1;
      }
      var cands = [];
      for (tau = TAUMIN + 1; tau < TAUMAX - 1; tau++) {
        if (cm[tau] < 0.5 && cm[tau] <= cm[tau - 1] && cm[tau] < cm[tau + 1]) cands.push(tau);
      }
      if (!cands.length) { var m = 1e9, bt = TAUMIN; for (tau = TAUMIN; tau < TAUMAX; tau++) if (cm[tau] < m) { m = cm[tau]; bt = tau; } cands.push(bt); }
      cands.sort(function (p, q) { return cm[p] - cm[q]; });
      if (cands.length > 4) cands.length = 4;
      var cl = [];
      for (var ci = 0; ci < cands.length; ci++) {
        var bt2 = cands[ci];
        var a1 = cm[bt2 - 1] === undefined ? cm[bt2] : cm[bt2 - 1], b1 = cm[bt2], c1 = cm[bt2 + 1] === undefined ? cm[bt2] : cm[bt2 + 1], den = a1 - 2 * b1 + c1;
        var sh = den !== 0 ? 0.5 * (a1 - c1) / den : 0;
        cl.push({ f: SR / (bt2 + (Math.abs(sh) < 1 ? sh : 0)), c: cm[bt2] });
      }
      cand[i] = cl; ap[i] = cm[cands[0]]; f0[i] = cl[0].f;
    }
    var sorted = Float32Array.from(db).sort();
    var p95 = sorted[Math.floor(n * 0.95)] || -40, p10 = sorted[Math.floor(n * 0.1)] || -80;
    var voiced = new Uint8Array(n), vf = [];
    for (i = 0; i < n; i++) {
      if (cand[i] && ap[i] < 0.25 && db[i] > p95 - 34 && f0[i] >= 65 && f0[i] <= 640) voiced[i] = 1;
    }
    // Viterbi over each voiced run: choose candidate path with smooth pitch (kills octave jumps)
    var LAMBDA = 0.05;
    i = 0;
    while (i < n) {
      if (!voiced[i]) { i++; continue; }
      j = i; while (j < n && voiced[j]) j++;
      var len = j - i, cost = [], bp = [];
      for (k = 0; k < len; k++) {
        var cl2 = cand[i + k], cc = [], bb = [];
        for (var u = 0; u < cl2.length; u++) {
          var o1 = cl2[u].c, bestc = o1, bi = -1;
          if (k > 0) {
            bestc = Infinity;
            var pl = cand[i + k - 1];
            for (var w2 = 0; w2 < pl.length; w2++) {
              var tr = cost[k - 1][w2] + LAMBDA * Math.abs(12 * Math.log2(cl2[u].f / pl[w2].f));
              if (tr < bestc) { bestc = tr; bi = w2; }
            }
            bestc += o1;
          }
          cc.push(bestc); bb.push(bi);
        }
        cost.push(cc); bp.push(bb);
      }
      var bu = 0; for (var u2 = 1; u2 < cost[len - 1].length; u2++) if (cost[len - 1][u2] < cost[len - 1][bu]) bu = u2;
      for (k = len - 1; k >= 0; k--) { f0[i + k] = cand[i + k][bu].f; bu = bp[k][bu]; }
      i = j;
    }
    for (i = 0; i < n; i++) if (voiced[i] && (f0[i] < 65 || f0[i] > 640)) voiced[i] = 0;
    for (i = 0; i < n; i++) if (voiced[i]) vf.push(f0[i]);
    var medHz = median(vf) || 150;
    var st = new Float32Array(n);
    for (i = 0; i < n; i++) st[i] = voiced[i] ? 12 * Math.log2(f0[i] / medHz) : 0;
    // drop blips (<4 frames)
    i = 0;
    while (i < n) {
      if (voiced[i]) { j = i; while (j < n && voiced[j]) j++; if (j - i < 4) for (k = i; k < j; k++) voiced[k] = 0; i = j; } else i++;
    }
    // fill short gaps (<=2 frames)
    i = 0;
    while (i < n) {
      if (!voiced[i]) {
        j = i; while (j < n && !voiced[j]) j++;
        if (i > 0 && j < n && j - i <= 2) { for (k = i; k < j; k++) { voiced[k] = 1; st[k] = st[i - 1] + (st[j] - st[i - 1]) * (k - i + 1) / (j - i + 1); } }
        i = j;
      } else i++;
    }
    // median filter (5) on voiced st
    var sm = new Float32Array(st);
    for (i = 2; i < n - 2; i++) {
      if (!voiced[i]) continue;
      var buf = [];
      for (k = i - 2; k <= i + 2; k++) if (voiced[k]) buf.push(st[k]);
      if (buf.length >= 3) sm[i] = median(buf);
    }
    return { n: n, db: db, voiced: voiced, st: sm, medHz: medHz, p95: p95, p10: p10 };
  }

  function activeRange(db, thr) {
    var n = db.length, a = -1, b = -1, run = 0, i;
    for (i = 0; i < n; i++) { if (db[i] > thr) { run++; if (run >= 8 && a < 0) a = i - 7; } else run = 0; }
    run = 0;
    for (i = n - 1; i >= 0; i--) { if (db[i] > thr) { run++; if (run >= 8 && b < 0) { b = i + 7; break; } } else run = 0; }
    return [a, b];
  }

  function feats(an, a0, a1) {
    var m = Math.floor((a1 - a0 + 1) / 2), e = new Float32Array(m), v = new Uint8Array(m), s = new Float32Array(m);
    var base = an.p95 - 40;
    for (var k = 0; k < m; k++) {
      var i = a0 + 2 * k, i2 = Math.min(an.n - 1, i + 1);
      e[k] = clamp(((an.db[i] + an.db[i2]) / 2 - base) / 40, 0, 1);
      var c = 0, sum = 0;
      if (an.voiced[i]) { c++; sum += an.st[i]; }
      if (an.voiced[i2]) { c++; sum += an.st[i2]; }
      if (c) { v[k] = 1; s[k] = sum / c; }
    }
    return { n: m, e: e, v: v, s: s, a0: a0 };
  }

  function dtw(A, B) {
    var N = A.n, M = B.n, PEN = 0.12;
    var half = Math.max(150, Math.floor(0.35 * Math.max(N, M)));
    var dir = new Uint8Array(N * M);
    var prev = new Float32Array(M), cur = new Float32Array(M);
    var i, j;
    for (i = 0; i < N; i++) {
      var ctr = i * M / N, jlo = Math.max(0, Math.floor(ctr - half)), jhi = Math.min(M - 1, Math.ceil(ctr + half));
      cur.fill(Infinity);
      for (j = jlo; j <= jhi; j++) {
        var cst = Math.abs(A.e[i] - B.e[j]);
        if (A.v[i] !== B.v[j]) cst += 0.45;
        else if (A.v[i]) cst += Math.min(Math.abs(A.s[i] - B.s[j]), 6) / 6 * 0.5;
        var best, dr;
        if (i === 0 && j === 0) { best = 0; dr = 0; } else {
          best = Infinity; dr = 0;
          if (i > 0 && j > 0 && prev[j - 1] < best) { best = prev[j - 1]; dr = 0; }
          if (i > 0 && prev[j] + PEN < best) { best = prev[j] + PEN; dr = 1; }
          if (j > 0 && cur[j - 1] + PEN < best) { best = cur[j - 1] + PEN; dr = 2; }
        }
        cur[j] = best + cst; dir[i * M + j] = dr;
      }
      var t = prev; prev = cur; cur = t;
    }
    var jMin = new Int32Array(N).fill(1 << 30), jMax = new Int32Array(N).fill(-1);
    i = N - 1; j = M - 1;
    for (;;) {
      if (j < jMin[i]) jMin[i] = j; if (j > jMax[i]) jMax[i] = j;
      if (i === 0 && j === 0) break;
      var dd = dir[i * M + j];
      if (dd === 0) { i--; j--; } else if (dd === 1) { i--; } else { j--; }
      if (i < 0 || j < 0) break;
    }
    var mid = new Float32Array(N);
    for (i = 0; i < N; i++) {
      if (jMax[i] < 0) { jMin[i] = i > 0 ? jMin[i - 1] : 0; jMax[i] = jMin[i]; }
      mid[i] = (jMin[i] + jMax[i]) / 2;
    }
    return { jMin: jMin, jMax: jMax, mid: mid };
  }

  function pearson(a, b) {
    var n = a.length; if (n < 8) return 0;
    var ma = 0, mb = 0, i; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var sab = 0, saa = 0, sbb = 0;
    for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa > 1e-6 && sbb > 1e-6 ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // last voiced run inside [f0,f1] (10 ms frames). returns {len, slope, ok}
  function tailRun(an, f0, f1) {
    var e = -1, i;
    f0 = Math.max(0, f0); f1 = Math.min(an.n - 1, f1);
    for (i = f1; i >= f0; i--) if (an.voiced[i]) { e = i; break; }
    if (e < 0) return { ok: false, len: 0, slope: 0 };
    var s = e, gap = 0;
    for (i = e; i >= f0; i--) { if (an.voiced[i]) { s = i; gap = 0; } else { gap++; if (gap > 3) break; } }
    var from = Math.max(s, e - 40), vals = [];
    for (i = from; i <= e; i++) if (an.voiced[i]) vals.push(an.st[i]);
    var q = Math.min(6, Math.floor(vals.length / 2)), slope = 0;
    if (q >= 2) {
      var h = 0, t = 0, k;
      for (k = 0; k < q; k++) { h += vals[k]; t += vals[vals.length - 1 - k]; }
      slope = (t - h) / q;
    }
    return { ok: true, len: (e - s + 1) * FS, slope: slope };
  }

  function prepareRef(chs, sr) {
    var x = toMono8k(chs, sr), an = analyzeSignal(x);
    var ra0 = Math.round(REF_T0 / FS), ra1 = Math.round(REF_T1 / FS);
    ref = { an: an, f: feats(an, ra0, ra1), ra0: ra0 };
    var vc = 0; for (var i = ra0; i <= ra1; i++) vc += an.voiced[i];
    return { ok: true, frames: an.n, medHz: Math.round(an.medHz), voicedPct: Math.round(100 * vc / (ra1 - ra0 + 1)) };
  }

  function score(chs, sr) {
    if (!ref) return { error: 'noref' };
    var x = toMono8k(chs, sr), an = analyzeSignal(x);
    var rng = activeRange(an.db, an.p95 - 30), a = rng[0], b = rng[1];
    var dur = (b - a + 1) * FS;
    if (a < 0 || b < 0 || dur < 12) return { error: 'short', seconds: Math.max(0, Math.round(dur)) };
    if (dur > 110) return { error: 'long', seconds: Math.round(dur) };
    var L0 = Math.max(0, a - 8), L1 = Math.min(an.n - 1, b + 8);
    var vc = 0, i, k; for (i = a; i <= b; i++) vc += an.voiced[i];
    var voicedPct = vc / (b - a + 1);
    if (voicedPct < 0.12) return { error: 'nopitch' };
    var FR = ref.f, FL = feats(an, L0, L1), N = FR.n, M = FL.n;
    var P = dtw(FR, FL);
    var T = M / N; // overall tempo ratio (learner / reference)
    var rAn = ref.an, kOf = function (t) { return clamp(Math.round((t / FS - ref.ra0) / 2), 0, N - 1); };

    // pass 1 : pairs per line
    var lines = [], allDiff = [];
    for (var li = 0; li < LINES.length; li++) {
      var Ln = LINES[li];
      var is = kOf(Ln.a[0]), ie = kOf(Ln.b[1]), iae = kOf(Ln.a[1]), ibs = kOf(Ln.b[0]);
      var sr_ = [], sl_ = [], tt = [], nRefV = 0, chart = { t: [], r: [], l: [] };
      for (k = is; k <= ie; k++) {
        var jr = clamp(Math.round(P.mid[k]), 0, M - 1);
        var rv = FR.v[k], lv = FL.v[jr];
        if (rv) nRefV++;
        if (rv && lv) { sr_.push(FR.s[k]); sl_.push(FL.s[jr]); allDiff.push(FL.s[jr] - FR.s[k]); }
        if (((k - is) & 1) === 0) {
          chart.t.push(+(((k - is) * 0.02)).toFixed(2));
          chart.r.push(rv ? +FR.s[k].toFixed(2) : null);
          chart.l.push(lv ? +FL.s[jr].toFixed(2) : null);
        }
      }
      lines.push({ is: is, ie: ie, iae: iae, ibs: ibs, sr: sr_, sl: sl_, nRefV: nRefV, chart: chart });
    }
    var gOff = allDiff.length ? median(allDiff) : 0;

    var res = [], sumM = 0, sumW = 0, sumR = 0, sumE = 0;
    for (li = 0; li < LINES.length; li++) {
      var q = lines[li], Lx = LINES[li];
      // melody
      var nP = q.sr.length, cov = q.nRefV ? nP / q.nRefV : 0, corr = pearson(q.sr, q.sl), se = 0;
      for (k = 0; k < nP; k++) { var dd = q.sl[k] - q.sr[k] - gOff; se += dd * dd; }
      var rmse = nP ? Math.sqrt(se / nP) : 9;
      var shape = clamp((corr - 0.1) / 0.75, 0, 1), level = gauss(rmse, 4.5);
      var melody = 100 * (0.6 * shape + 0.4 * level) * (0.55 + 0.45 * Math.min(1, cov / 0.7));
      // rhythm
      var jS = P.jMin[q.is], jE = P.jMax[q.ie];
      var lenL = Math.max(1, jE - jS) * 0.02, lenR = Math.max(1, q.ie - q.is) * 0.02;
      var durRatio = (lenL / lenR) / T;
      var durScore = gauss(Math.abs(Math.log(Math.max(durRatio, 0.05))), 0.35);
      var aL = Math.max(1, P.jMax[q.iae] - P.jMin[q.is]), bL = Math.max(1, P.jMax[q.ie] - P.jMin[q.ibs]);
      var aR = Math.max(1, q.iae - q.is), bR = Math.max(1, q.ie - q.ibs);
      var splitL = aL / (aL + bL), splitR = aR / (aR + bR), splitDiff = splitL - splitR;
      var splitScore = gauss(Math.abs(splitDiff), 0.16);
      var pauseScore = 1, pauseRatio = 1;
      if (li < LINES.length - 1) {
        var nq = lines[li + 1];
        var gR = Math.max(0, nq.is - q.ie) * 0.02, gL = Math.max(0, P.jMin[nq.is] - P.jMax[q.ie]) * 0.02;
        pauseRatio = ((gL / T) + 0.15) / (gR + 0.15);
        pauseScore = gauss(Math.abs(Math.log(pauseRatio)), 0.75);
      }
      var rhythm = 100 * (0.5 * durScore + 0.3 * splitScore + 0.2 * pauseScore);
      // ending
      var rT = tailRun(rAn, ref.ra0 + 2 * q.ibs, ref.ra0 + 2 * q.ie);
      var lT = tailRun(an, L0 + 2 * P.jMin[q.ibs], L0 + 2 * P.jMax[q.ie]);
      var endLenRatio = 1, endSlopeDiff = 0, ending;
      if (lT.ok && rT.ok) {
        endLenRatio = (lT.len / Math.max(0.05, rT.len)) / T;
        endSlopeDiff = lT.slope - rT.slope;
        ending = 100 * (0.55 * gauss(Math.abs(Math.log(Math.max(endLenRatio, 0.05))), 0.55) + 0.45 * gauss(Math.abs(endSlopeDiff), 4.5));
      } else ending = 20;
      var total = 0.45 * melody + 0.35 * rhythm + 0.2 * ending;
      var w = q.nRefV || 1;
      sumM += melody * w; sumW += w; sumR += rhythm; sumE += ending;
      res.push({
        idx: li, melody: Math.round(melody), rhythm: Math.round(rhythm), ending: Math.round(ending), total: Math.round(total),
        learnerStart: +((L0 + 2 * jS) * FS).toFixed(2), learnerEnd: +((L0 + 2 * jE) * FS).toFixed(2),
        detail: {
          corr: +corr.toFixed(2), rmse: +rmse.toFixed(1), coverage: +cov.toFixed(2), durRatio: +durRatio.toFixed(2),
          splitDiff: +splitDiff.toFixed(2), pauseRatio: +pauseRatio.toFixed(2), endLenRatio: +endLenRatio.toFixed(2),
          endSlopeDiff: +endSlopeDiff.toFixed(1), endOk: lT.ok
        },
        chart: q.chart
      });
    }
    var nL = LINES.length;
    var mel = sumM / sumW, rhy = sumR / nL, end = sumE / nL, tot = 0.45 * mel + 0.35 * rhy + 0.2 * end;
    return {
      total: Math.round(tot), melody: Math.round(mel), rhythm: Math.round(rhy), ending: Math.round(end),
      tempo: +T.toFixed(2), seconds: +dur.toFixed(1), voicedPct: Math.round(voicedPct * 100),
      snr: Math.round(an.p95 - an.p10), lines: res, offsetSt: +gOff.toFixed(1)
    };
  }

  return { LINES: LINES, prepareRef: prepareRef, score: score };
})();


module.exports=Analyzer;
