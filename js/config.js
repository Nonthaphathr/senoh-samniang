/* ตั้งค่าระบบ (แก้ตรงนี้ที่เดียว) */
window.APP_CONFIG = {
  VERSION: '2.0.0-dev',
  SYSTEM_NAME: 'เสนาะสำเนียง',
  SYSTEM_SUB: 'By ครูนนท์ · ฝึกอ่านทำนองเสนาะ',
  // Firebase โปรเจกต์ senoh-samniang (Firestore asia-southeast1, Auth: Anonymous + Google)
  FB_CONFIG: {
    apiKey: 'AIzaSyAGJXUasNcHLDsAHqRaYrYLLKxm_Hq6TY8',
    authDomain: 'senoh-samniang.firebaseapp.com',
    projectId: 'senoh-samniang',
    storageBucket: 'senoh-samniang.firebasestorage.app',
    messagingSenderId: '532949998243',
    appId: '1:532949998243:web:a6ae974b35f488de10fd16'
  },
  GAS_URL: '',                                // URL ของ GAS Web App (ช่วง 3)
  POEM_INDEX: 'poems/index.json',             // รายการบทอ่านในเครื่อง (ใช้ได้โดยไม่ต้องมี Firebase)
  DEFAULT_POEM: 'yani11',                     // เปลี่ยนบทได้ด้วย ?poem=<id> → poems/<id>.json
  COLLECTION: 'attempts',
  LS_KEY: 'senoh.v2.attempts', LS_USER: 'senoh.v2.user',
  LEGACY_LS_KEY: 'yani11.v1.attempts', LEGACY_LS_USER: 'yani11.v1.user'
};
