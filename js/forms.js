/* แม่แบบชนิดคำประพันธ์ + ตัวแยกตัวบท (PLAN ข้อ 7)
   ครูตรวจตารางนี้ก่อนใช้จริง โดยเฉพาะ split (รูปแบบช่วงจังหวะเป็นจำนวนคำ) — แต่ละสำนักอ่านแบ่งต่างกันได้
   เพิ่มชนิดใหม่: เพิ่มรายการใน FORMS ได้เลย */
var Forms = (function () {
  'use strict';
  var FORMS = {
    kapyani11:       { name: 'กาพย์ยานี ๑๑', perStanza: 4, roles: ['สดับ', 'รับ', 'รอง', 'ส่ง'], words: [5, 6, 5, 6], split: [[2, 3], [3, 3], [2, 3], [3, 3]], layout: 'two', icon: 'kap',
                       howto: 'หนึ่งวรรคมี ๕ หรือ ๖ คำ แบ่งจังหวะเป็น ๒ / ๓ หรือ ๓ / ๓ คำ เว้นเสียงเล็กน้อยตรงเครื่องหมายเว้นจังหวะ แล้วทอดเสียงท้ายวรรคให้ต่อเนื่องก่อนเข้าวรรคถัดไป วรรคทั้งสี่ในแต่ละบทเรียกว่า สดับ · รับ · รอง · ส่ง' },
    kapchabang16:    { name: 'กาพย์ฉบัง ๑๖', perStanza: 3, roles: ['ที่ ๑', 'ที่ ๒', 'ที่ ๓'], words: [6, 4, 6], split: [[2, 2, 2], [2, 2], [2, 2, 2]], layout: 'two-mid', icon: 'kap',
                       howto: 'หนึ่งบทมี ๓ วรรค คือ ๖ ๔ ๖ คำ อ่านแบ่งจังหวะทีละ ๒ คำ ทอดเสียงท้ายวรรค' },
    kapsurang28:     { name: 'กาพย์สุรางคนางค์ ๒๘', perStanza: 7, roles: ['ที่ ๑', 'ที่ ๒', 'ที่ ๓', 'ที่ ๔', 'ที่ ๕', 'ที่ ๖', 'ที่ ๗'], words: [4, 4, 4, 4, 4, 4, 4], split: [[2, 2]], layout: 'list', icon: 'kap',
                       howto: 'หนึ่งบทมี ๗ วรรค วรรคละ ๔ คำ อ่านแบ่งจังหวะ ๒ / ๒ คำ' },
    klonsuphap:      { name: 'กลอนสุภาพ (กลอนแปด)', perStanza: 4, roles: ['สดับ', 'รับ', 'รอง', 'ส่ง'], words: [8, 8, 8, 8], split: [[3, 2, 3]], layout: 'two', icon: 'klon',
                       howto: 'วรรคละ ๗–๙ คำ อ่านแบ่งจังหวะ ๓ / ๒ / ๓ คำ ทอดเสียงท้ายวรรค วรรคทั้งสี่คือ สดับ · รับ · รอง · ส่ง' },
    khlongsi:        { name: 'โคลงสี่สุภาพ', perStanza: 8, roles: ['บาท ๑ วรรคหน้า', 'บาท ๑ วรรคหลัง', 'บาท ๒ วรรคหน้า', 'บาท ๒ วรรคหลัง', 'บาท ๓ วรรคหน้า', 'บาท ๓ วรรคหลัง', 'บาท ๔ วรรคหน้า', 'บาท ๔ วรรคหลัง'], words: [5, 2, 5, 2, 5, 2, 5, 4], split: [[2, 3], [2], [2, 3], [2], [2, 3], [2], [2, 3], [2, 2]], layout: 'bat', icon: 'khlong',
                       howto: 'หนึ่งบทมี ๔ บาท บาทละ ๒ วรรค วรรคหน้า ๕ คำ วรรคหลัง ๒ คำ (บาทสุดท้าย ๔ คำ) มีคำสร้อยได้' },
    intharawichian11:{ name: 'อินทรวิเชียรฉันท์ ๑๑', perStanza: 4, roles: ['ที่ ๑', 'ที่ ๒', 'ที่ ๓', 'ที่ ๔'], words: [5, 6, 5, 6], split: [[2, 3], [3, 3], [2, 3], [3, 3]], layout: 'two', icon: 'chan',
                       howto: 'วรรคหน้า ๕ คำ วรรคหลัง ๖ คำ อ่านตามเสียงครุ ลหุ แบ่งจังหวะ ๒ / ๓ และ ๓ / ๓ คำ' },
    rai:             { name: 'ร่าย', perStanza: 0, roles: [], words: [5], split: [[2, 3]], layout: 'list', icon: 'rai',
                       howto: 'วรรคละประมาณ ๕ คำ ส่งสัมผัสต่อกันไปเรื่อย ๆ อ่านต่อเนื่องและทอดเสียงตอนจบ' },
    custom:          { name: 'กำหนดเอง', perStanza: 0, roles: [], words: [], split: [], layout: 'list', icon: 'kap', howto: '' }
  };

  /* นับพยางค์ไทยแบบประมาณ (ใช้ถ่วงสัดส่วนเวลา ไม่ต้องแม่นระดับตัดคำ) */
  var LEAD = 'เแโใไ', VOW = 'ะาำิีึืุูั็ๅ', CONS = /[ก-ฮ]/;
  function countSyllables(t) {
    t = String(t || '').replace(/[^฀-๿]/g, '');
    var v = 0, c = 0, i, last = -9;
    for (i = 0; i < t.length; i++) {
      var ch = t[i], nx = t[i + 1];
      if (LEAD.indexOf(ch) >= 0) { v++; last = i; continue; }
      if (VOW.indexOf(ch) >= 0) { if (i - last > 3) v++; continue; }
      if (ch === '์') { c--; continue; }               // ตัวการันต์ไม่ออกเสียง
      if (CONS.test(ch) && nx !== '์') c++;
    }
    return Math.max(1, v, Math.round(c / 2.4));
  }

  /* ตัวบทดิบ: ขึ้นบรรทัดใหม่ = วรรค, "/" = แบ่งช่วงจังหวะในวรรค, บรรทัดว่าง = ขึ้นบทใหม่ */
  function parseText(text, formId) {
    var F = FORMS[formId] || FORMS.custom, units = [], stanza = 0, inSt = 0, pending = false;
    String(text || '').replace(/\r/g, '').split('\n').forEach(function (line) {
      var s = line.trim();
      if (!s) { if (inSt) pending = true; return; }
      if (pending || (F.perStanza && inSt >= F.perStanza)) { stanza++; inSt = 0; pending = false; }
      var parts = s.split(/\s*\/\s*/).filter(Boolean);
      units.push({ stanza: stanza, idx: units.length, role: F.roles.length ? F.roles[inSt % F.roles.length] : '', groups: parts.map(function (p) { return { text: p, t0: null, t1: null }; }), userSplit: parts.length > 1 });
      inSt++;
    });
    return units;
  }
  function shapeOf(units) { return units.map(function (u) { return u.groups.length; }); }
  function sylOf(units) { return units.map(function (u) { return u.groups.map(function (g) { return countSyllables(g.text); }); }); }
  /* ข้อความกำกับจำนวนคำ เช่น "๒ / ๓ คำ" ใช้เมื่อจำนวนช่วงตรงกับแม่แบบ */
  function splitLabel(formId, unitPos, nGroups) {
    var F = FORMS[formId]; if (!F || !F.split.length) return '';
    var sp = F.split[unitPos % F.split.length];
    return sp && sp.length === nGroups ? sp.join(' / ') : '';
  }
  function get(id) { return FORMS[id] || FORMS.custom; }
  function list() { return Object.keys(FORMS).map(function (k) { return { id: k, name: FORMS[k].name }; }); }
  return { FORMS: FORMS, get: get, list: list, countSyllables: countSyllables, parseText: parseText, shapeOf: shapeOf, sylOf: sylOf, splitLabel: splitLabel };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Forms;
