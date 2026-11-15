// ทดสอบถดถอยแบบรันด้วย Node: node tests/regression-node.js <ref.f32> <test1.f32> …   (ไฟล์ PCM float32 โมโน 44.1 kHz จาก ffmpeg -f f32le)
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const OldA = require(process.env.LEGACY_ANALYZER || path.join(__dirname, 'legacy_analyzer.js'));
const NewA = require(path.join(root, 'js/analyzer.js'));
const poem = JSON.parse(fs.readFileSync(path.join(root, 'poems/yani11.json'), 'utf8'));
const spec = { t0: poem.refT0, t1: poem.refT1, units: poem.units.map(u => ({ groups: u.groups.map(g => [g.t0, g.t1]) })) };
const rd = f => { const b = fs.readFileSync(f); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };
const SR = 44100, [refF, ...tests] = process.argv.slice(2);
const ref = rd(refF);
OldA.prepareRef([ref.slice()], SR); NewA.prepareRef([ref.slice()], SR, spec);
let worst = 0, fail = 0;
for (const f of [refF, ...tests]) {
  const x = rd(f), o = OldA.score([x.slice()], SR), n = NewA.score([x.slice()], SR, {});
  if (o.error || n.error) { console.log(path.basename(f), 'error', o.error, n.error); if (o.error !== n.error) fail++; continue; }
  let md = 0;
  o.lines.forEach((L, i) => ['melody', 'rhythm', 'ending'].forEach(k => { md = Math.max(md, Math.abs(L[k] - n.lines[i][k])); }));
  worst = Math.max(worst, md); if (md > 1) fail++;
  console.log(path.basename(f).padEnd(12), 'old', o.total, `(m${o.melody} r${o.rhythm} e${o.ending})`, '| new', n.total, `(m${n.melody} r${n.rhythm} e${n.ending} c${n.complete})`, 'tempo', n.tempo, '| max line diff', md);
}
console.log(fail ? 'FAIL' : 'PASS', 'worst per-line diff =', worst);
process.exit(fail ? 1 : 0);
