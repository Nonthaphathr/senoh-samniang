/* Web Worker: รันแกนวิเคราะห์นอกเธรดหน้าจอ */
importScripts('analyzer.js', 'segment.js');
self.onmessage = function (e) {
  var m = e.data, r;
  try {
    if (m.cmd === 'ref') r = Analyzer.prepareRef(m.chs, m.sr, m.spec);
    else if (m.cmd === 'segment') r = Analyzer.segment(m.chs, m.sr, m.shape, m.opts);
    else r = Analyzer.score(m.chs, m.sr, m.opts);
    self.postMessage({ id: m.id, ok: true, r: r });
  } catch (err) { self.postMessage({ id: m.id, ok: false, e: String(err && err.message || err) }); }
};
