# ทดสอบถดถอย (PLAN ข้อ 6.4)

- เปิดในเบราว์เซอร์: `tests/regression.html` (ต้องเปิดผ่านเว็บเซิร์ฟเวอร์ เช่น GitHub Pages) แล้วเลือกไฟล์เสียงอัดทดสอบ
- รันด้วย Node (ไม่ต้องเปิดเบราว์เซอร์):
  ```
  ffmpeg -i audio/yani11.mp3 -ac 1 -ar 44100 -f f32le ref.f32
  ffmpeg -i tests/ครูอ่านดี.m4a -ac 1 -ar 44100 -f f32le t1.f32
  node tests/regression-node.js ref.f32 t1.f32
  ```
- `legacy_analyzer.js` = แกนวิเคราะห์เดิมที่ดึงออกจาก `_legacy/index.html` (ห้ามแก้ ใช้เป็นตัวเทียบ)
- ยังขาด: เสียงอัดของครู 2 ไฟล์ (อ่านดี 1, อ่านเร็ว/ไม่เอื้อน 1) วางไว้ในโฟลเดอร์นี้
