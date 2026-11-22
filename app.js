/* Sun Child Care Academy Non Government Primary School — Supabase-backed school management */
const SCHOOL_ID = window.SCHOOL_CONFIG.schoolId;
const dbClient = window.supabase.createClient(window.SCHOOL_CONFIG.url, window.SCHOOL_CONFIG.publishableKey);
let db = emptyDatabase();
let currentUser = null;
let currentProfile = null;
let authMode = 'login';
let passwordRecovery = false;
let currentPage = 'home';
let searchText = '';
let ipemisProfile = null;
let attendanceDate = localDateISO();

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');

function localDateISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateISO(d); }
function esc(value = '') {
  return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function bn(value) { return new Intl.NumberFormat('bn-BD').format(Number(value) || 0); }
function money(value) { return `৳ ${bn(value)}`; }
function prettyDate(value, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat('bn-BD', { ...opts, timeZone: 'Asia/Dhaka' }).format(date);
}
function shortDate(value) { return prettyDate(value, { day: 'numeric', month: 'short' }); }
function uid(prefix = 'id') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function initials(name = '') { return String(name).trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join(''); }
function toast(message, error = false) {
  const node = document.createElement('div');
  node.className = `toast${error ? ' error' : ''}`;
  node.textContent = message;
  document.querySelector('#toast-root').append(node);
  setTimeout(() => node.remove(), 3200);
}
function normalizePhone(phone) { return String(phone || '').trim(); }

function emptyDatabase() {
  return { settings: { schoolName: 'Sun Child Care Academy Non Government Primary School', motto: '', session: '', phone: '', email: '', address: '' }, classes: [], students: [], teachers: [], attendance: {}, fees: [], notices: [], documents: [] };
}
function backendError(error) {
  const message = String(error?.message || error || 'অজানা সমস্যা');
  if (/Invalid login credentials/i.test(message)) return 'ইমেইল বা পাসওয়ার্ড সঠিক নয়।';
  if (/Email not confirmed/i.test(message)) return 'ইমেইল নিশ্চিত করে আবার লগইন করুন।';
  if (/duplicate key|already exists/i.test(message)) return 'এই তথ্যটি আগে থেকেই আছে।';
  if (/row-level security|permission denied/i.test(message)) return 'এই কাজের অনুমতি নেই। অ্যাডমিন অ্যাকাউন্ট দিয়ে প্রবেশ করুন।';
  return message;
}
async function loadPublicData() {
  const [{ data: school, error: schoolError }, { data: notices, error: noticesError }] = await Promise.all([
    dbClient.from('schools').select('id,name,motto,session,phone,email,address').eq('id', SCHOOL_ID).maybeSingle(),
    dbClient.from('notices').select('id,title,date,type,body').eq('school_id', SCHOOL_ID).eq('is_published', true).order('date', { ascending: false }).limit(12)
  ]);
  if (schoolError) throw schoolError;
  if (noticesError) throw noticesError;
  if (school) db.settings = { schoolName: school.name, motto: school.motto, session: school.session, phone: school.phone, email: school.email, address: school.address };
  db.notices = (notices || []).map(row => ({ id: row.id, title: row.title, date: row.date, type: row.type, body: row.body }));
}
async function loadProfile() {
  if (!currentUser) { currentProfile = null; return null; }
  const { data, error } = await dbClient.from('profiles').select('user_id,school_id,role,display_name,is_active').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  currentProfile = data;
  return data;
}
async function loadSchoolData() {
  const names = ['classes','students','teachers','attendance','fee_records','notices','documents'];
  const results = await Promise.all(names.map(name => dbClient.from(name).select('*').eq('school_id', currentProfile.school_id)));
  for (let i = 0; i < results.length; i++) if (results[i].error) throw results[i].error;
  const rows = Object.fromEntries(names.map((name, i) => [name, results[i].data || []]));
  const schoolResult = await dbClient.from('schools').select('id,name,motto,session,phone,email,address').eq('id', currentProfile.school_id).single();
  if (schoolResult.error) throw schoolResult.error;
  const school = schoolResult.data;
  db.settings = { schoolName: school.name, motto: school.motto, session: school.session, phone: school.phone, email: school.email, address: school.address };
  db.classes = rows.classes.map(x => ({ id:x.id, name:x.name, teacher:x.teacher, room:x.room }));
  db.students = rows.students.map(x => ({ id:x.id, name:x.name, guardian:x.guardian, classId:x.class_id || '', roll:x.roll, phone:x.phone, admission:x.admission, status:x.status }));
  db.teachers = rows.teachers.map(x => ({ id:x.id, name:x.name, subject:x.subject, phone:x.phone, email:x.email }));
  db.attendance = {};
  rows.attendance.forEach(x => { (db.attendance[x.attendance_date] ||= {})[x.student_id] = x.status; });
  db.fees = rows.fee_records.map(x => ({ id:x.id, studentId:x.student_id, month:x.month, due:Number(x.amount_due), paid:Number(x.amount_paid), date:x.paid_at || '' }));
  db.notices = rows.notices.map(x => ({ id:x.id, title:x.title, date:x.date, type:x.type, body:x.body, published:x.is_published }));
  db.documents = rows.documents.map(x => ({ id:x.id, name:x.name, category:x.category, note:x.note, storagePath:x.storage_path, uploadedAt:x.uploaded_at.slice(0,10), size:Number(x.size_bytes), mime:x.mime_type }));
}
async function initialize() {
  try {
    const response = await fetch('data/ipemis-school-profile.json', { cache: 'no-store' });
    if (response.ok) ipemisProfile = await response.json();
  } catch (error) { console.info('IPEMIS snapshot unavailable', error); }
  dbClient.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      window.setTimeout(() => { currentUser=session?.user || null; passwordRecovery=true; render(); }, 0);
    }
  });
  try {
    await loadPublicData();
    const { data, error } = await dbClient.auth.getSession();
    if (error) throw error;
    currentUser = data.session?.user || null;
    if (currentUser) {
      await loadProfile();
      if (currentProfile?.role === 'admin' && currentProfile.is_active) await loadSchoolData();
    }
  } catch (error) { toast(`Backend সংযোগ করা যায়নি: ${backendError(error)}`, true); }
  render();
}
async function refreshData(message = '') {
  try { await loadSchoolData(); render(); if (message) toast(message); return true; }
  catch (error) { toast(backendError(error), true); return false; }
}
function getClass(id) { return db.classes.find(c => c.id === id); }
function getStudent(id) { return db.students.find(s => s.id === id); }
function studentClassName(student) { return getClass(student?.classId)?.name || 'শ্রেণি নেই'; }
function isLoggedIn() { return Boolean(currentUser && currentProfile?.role === 'admin' && currentProfile.is_active); }
function goTo(page) { currentPage = page; searchText = ''; document.querySelector('.sidebar')?.classList.remove('open'); render(); window.scrollTo(0, 0); }

const NAV = [
  { id: 'dashboard', label: 'ড্যাশবোর্ড', icon: '▦', group: 'প্রধান মেনু' },
  { id: 'students', label: 'শিক্ষার্থী', icon: '♙' },
  { id: 'teachers', label: 'শিক্ষক', icon: '♧' },
  { id: 'classes', label: 'শ্রেণি ও বিভাগ', icon: '▤' },
  { id: 'attendance', label: 'উপস্থিতি', icon: '✓' },
  { id: 'fees', label: 'বেতন ও ফি', icon: '৳' },
  { id: 'notices', label: 'নোটিশ', icon: '▣', group: 'যোগাযোগ' },
  { id: 'documents', label: 'ডিজিটাল নথি', icon: '▧' },
  { id: 'settings', label: 'সেটিংস ও ব্যাকআপ', icon: '⚙', group: 'প্রশাসন' }
];

function render() {
  if (passwordRecovery) {
    renderPasswordRecovery();
  } else if (currentUser && !currentProfile) {
    renderAdminSetup();
  } else if (isLoggedIn()) {
    if (currentPage === 'home' || currentPage === 'login') currentPage = 'dashboard';
    renderApp();
  } else if (currentPage === 'login') renderLogin();
  else renderPublic();
}

function renderPublic() {
  const notices = [...db.notices].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 2);
  app.innerHTML = `
    <div class="public-site">
      <header class="public-nav">
        <a class="brand" href="#home" data-nav="home">
          <span class="brand-mark">✦</span><span class="brand-copy"><strong>${esc(db.settings.schoolName)}</strong><span>প্রাথমিক শিক্ষা • রাজশাহী, বাঘা</span></span>
        </a>
        <nav class="public-links"><a href="#school">আমাদের বিদ্যালয়</a><a href="#facilities">সুবিধাসমূহ</a><a href="#public-notices">নোটিশ</a></nav>
        <button class="btn btn-primary" data-action="login">অ্যাডমিন লগইন <span aria-hidden="true">→</span></button>
      </header>
      <section class="hero" id="school">
        <span class="hero-spark one">✦</span><span class="hero-spark two">✧</span>
        <div class="hero-content">
          <span class="eyebrow"><i class="eyebrow-dot"></i> ${esc(db.settings.session)} • বিদ্যালয় পরিচিতি</span>
          <h1>শেখার আনন্দে<br/>গড়ি সুন্দর আগামী</h1>
          <p>${esc(db.settings.motto)} — প্রতিটি শিশুর কৌতূহল, মেধা ও সম্ভাবনাকে যত্নে বিকশিত করাই আমাদের অঙ্গীকার।</p>
          <div class="hero-actions"><a class="btn btn-primary" href="#public-notices">সর্বশেষ নোটিশ দেখুন <span>↗</span></a><a class="btn btn-outline" href="#facilities">বিদ্যালয় সম্পর্কে</a></div>
        </div>
        <div class="hero-illustration" aria-hidden="true"><div class="school-illustration"><div class="school-flag"></div><div class="school-roof"></div><div class="school-body"><div class="school-window"></div><div class="school-door"></div><div class="school-window"></div></div><div class="school-base"></div></div></div>
      </section>
      <section class="section" id="ipemis-profile">
        <div class="section-heading"><div><h2>IPEMIS বিদ্যালয় পরিচিতি</h2><p>সরকারি পোর্টালের প্রোফাইল স্ক্রিনশট থেকে সংরক্ষিত তথ্য; এটি লাইভ সিঙ্ক নয়।</p></div></div>
        ${ipemisProfile ? `<div class="feature-grid">${[
          ['স্কুল কোড', ipemisProfile.schoolCode], ['ইএমআইএস কোড', ipemisProfile.emisCode],
          ['বিভাগ', ipemisProfile.division], ['জেলা', ipemisProfile.district],
          ['উপজেলা', ipemisProfile.upazila], ['বিদ্যালয়ের ধরন', ipemisProfile.ipemisSchoolCategory],
          ['বিদ্যালয়ের গ্রেড', ipemisProfile.schoolGrade], ['অনুমোদিত পদ', ipemisProfile.approvedPosts],
          ['শূন্য পদ', ipemisProfile.vacantPosts], ['প্রোফাইল সম্পূর্ণ', ipemisProfile.profileCompletionPercent + '%']
        ].map(([label, value]) => `<article class="feature-card"><h3>${esc(label)}</h3><p>${esc(value ?? '—')}</p></article>`).join('')}</div>` : '<p>প্রোফাইল তথ্য এখন পাওয়া যাচ্ছে না।</p>'}
      </section>
      <section class="public-stats" aria-label="বিদ্যালয়ের পরিসংখ্যান">
        <div class="public-stat"><strong>${esc(ipemisProfile?.schoolCode || "—")}</strong><span>স্কুল কোড</span></div>
        <div class="public-stat"><strong>${esc(ipemisProfile?.schoolGrade || "—")}</strong><span>বিদ্যালয়ের গ্রেড</span></div>
        <div class="public-stat"><strong>${esc(ipemisProfile?.approvedPosts ?? "—")}</strong><span>অনুমোদিত পদ</span></div>
        <div class="public-stat"><strong>${esc(ipemisProfile ? ipemisProfile.profileCompletionPercent + "%" : "—")}</strong><span>IPEMIS প্রোফাইল সম্পূর্ণ</span></div>
      </section>
      <section class="section" id="facilities">
        <div class="section-heading"><div><h2>শেখার সুন্দর পরিবেশ</h2><p>শিশুদের প্রতিদিনের জন্য নিরাপদ, আনন্দময় ও যত্নশীল একটি বিদ্যালয়</p></div></div>
        <div class="feature-grid">
          <article class="feature-card"><span class="feature-icon">✎</span><h3>শিক্ষার্থী-কেন্দ্রিক পাঠ</h3><p>খেলাধুলা, গল্প ও হাতে-কলমে শেখার মাধ্যমে প্রতিটি শিশুর মেধা বিকাশে মনোযোগ।</p></article>
          <article class="feature-card"><span class="feature-icon">♡</span><h3>স্নেহময় শিক্ষকবৃন্দ</h3><p>অভিজ্ঞ ও যত্নশীল শিক্ষকেরা শিশুর পড়াশোনা, সৃজনশীলতা ও আত্মবিশ্বাস গড়ে তোলেন।</p></article>
          <article class="feature-card"><span class="feature-icon">⌂</span><h3>নিরাপদ বিদ্যালয়</h3><p>পরিচ্ছন্ন শ্রেণিকক্ষ, খেলার জায়গা ও শিশুবান্ধব পরিবেশে প্রতিদিনের আনন্দময় শিক্ষা।</p></article>
        </div>
      </section>
      <section class="section" id="public-notices">
        <div class="section-heading"><div><h2>বিদ্যালয়ের নোটিশ</h2><p>সাম্প্রতিক ঘোষণা ও কার্যক্রম</p></div><button class="btn btn-outline btn-small" data-action="login">সব নোটিশ <span>→</span></button></div>
        <div class="notice-grid">${notices.length ? notices.map(n => `<article class="public-notice"><small>${esc(n.type || 'ঘোষণা')} • ${prettyDate(n.date)}</small><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('') : '<div class="empty-state">এখনো কোনো নোটিশ প্রকাশ করা হয়নি।</div>'}</div>
      </section>
      <footer class="public-footer"><strong>${esc(db.settings.schoolName)}</strong>${esc(db.settings.address)} • ${esc(db.settings.phone)}<br/>© ${new Date().getFullYear()} • সকল অধিকার সংরক্ষিত</footer>
    </div>`;
}

function renderLogin() {
  const signup = authMode === 'signup';
  app.innerHTML = `
    <div class="login-screen">
      <aside class="login-aside"><div class="login-aside-inner">
        <div class="brand"><span class="brand-mark">✦</span><span class="brand-copy"><strong>${esc(db.settings.schoolName)}</strong><span>ডিজিটাল স্কুল ব্যবস্থাপনা</span></span></div>
        <h1>এক জায়গায়<br/>বিদ্যালয়ের সব কাজ</h1>
        <p>শিক্ষার্থী, শিক্ষক, উপস্থিতি, ফি ও নথি—সহজে ও সুশৃঙ্খলভাবে পরিচালনা করুন।</p>
        <div class="login-bullets"><span>কাগজবিহীন তথ্য ব্যবস্থাপনা</span><span>দ্রুত ব্যাকআপ ও রিপোর্ট</span><span>বিদ্যালয়ের জন্য সহজ ড্যাশবোর্ড</span></div>
      </div></aside>
      <section class="login-card-wrap"><div class="login-card">
        <span class="eyebrow" style="color:#47725d;border-color:#d9e8dc;background:#f3f8f4;margin-bottom:16px">প্রশাসনিক প্রবেশ</span>
        <h2>${signup ? 'প্রথম অ্যাডমিন অ্যাকাউন্ট' : 'অ্যাডমিন লগইন'}</h2>
        <p>${signup ? 'নিজের ইমেইল ও পাসওয়ার্ড দিয়ে অ্যাকাউন্ট তৈরি করুন।' : 'আপনার অ্যাডমিন অ্যাকাউন্ট দিয়ে প্রবেশ করুন।'}</p>
        ${signup ? `<form id="signup-form"><div class="field"><label>আপনার নাম</label><input name="displayName" autocomplete="name" required minlength="2" /></div><div class="field"><label>ইমেইল</label><input name="email" type="email" autocomplete="email" required placeholder="name@school.edu.bd" /></div><div class="field"><label>পাসওয়ার্ড</label><input name="password" type="password" autocomplete="new-password" minlength="8" required /></div><button class="btn btn-primary" type="submit" style="width:100%;margin-top:4px">অ্যাকাউন্ট তৈরি করুন <span>→</span></button></form>` : `<form id="login-form"><div class="field"><label for="login-email">ইমেইল</label><input id="login-email" name="email" type="email" autocomplete="username" required placeholder="name@school.edu.bd" /></div><div class="field"><label for="login-password">পাসওয়ার্ড</label><input id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="আপনার পাসওয়ার্ড" /></div><button class="btn btn-primary" type="submit" style="width:100%;margin-top:4px">নিরাপদে প্রবেশ করুন <span>→</span></button><button class="btn btn-quiet" type="button" data-action="reset-password">পাসওয়ার্ড ভুলে গেছেন?</button></form>`}
        <button class="btn btn-quiet login-home" type="button" data-action="toggle-auth">${signup ? 'আগে অ্যাকাউন্ট আছে? লগইন করুন' : 'প্রথমবার? অ্যাডমিন অ্যাকাউন্ট তৈরি করুন'}</button>
        <button class="btn btn-quiet login-home" type="button" data-action="home">← বিদ্যালয়ের পাতায় ফিরে যান</button>
      </div></section>
    </div>`;
}

function renderAdminSetup() {
  app.innerHTML = `<div class="login-screen"><aside class="login-aside"><div class="login-aside-inner"><div class="brand"><span class="brand-mark">✦</span><span class="brand-copy"><strong>${esc(db.settings.schoolName)}</strong><span>ডিজিটাল স্কুল ব্যবস্থাপনা</span></span></div><h1>অ্যাডমিন সেটআপ<br/>প্রায় সম্পূর্ণ</h1><p>অ্যাকাউন্ট নিশ্চিত হলে একবারের সেটআপ কী দিয়ে এই বিদ্যালয়ের প্রথম অ্যাডমিন হিসেবে প্রবেশ করুন।</p></div></aside><section class="login-card-wrap"><form class="login-card" id="admin-setup-form"><span class="eyebrow" style="color:#47725d;border-color:#d9e8dc;background:#f3f8f4;margin-bottom:16px">প্রথম অ্যাডমিন যাচাই</span><h2>অ্যাডমিন সেটআপ সম্পন্ন করুন</h2><p>${esc(currentUser?.email || '')} দিয়ে প্রবেশ করা হয়েছে। আপনার নাম ও একবারের সেটআপ কী দিন।</p><div class="field"><label>অ্যাডমিনের নাম</label><input name="displayName" autocomplete="name" required minlength="2" value="${esc(currentUser?.user_metadata?.display_name || '')}" /></div><div class="field"><label>একবারের সেটআপ কী</label><input name="setupKey" type="password" autocomplete="off" required /></div><button class="btn btn-primary" type="submit" style="width:100%">সেটআপ সম্পন্ন করুন <span>→</span></button><button class="btn btn-quiet login-home" type="button" data-action="logout">লগআউট</button></form></section></div>`;
}

function renderPasswordRecovery() {
  app.innerHTML = `<div class="login-screen"><aside class="login-aside"><div class="login-aside-inner"><div class="brand"><span class="brand-mark">✦</span><span class="brand-copy"><strong>${esc(db.settings.schoolName)}</strong><span>ডিজিটাল স্কুল ব্যবস্থাপনা</span></span></div><h1>নতুন পাসওয়ার্ড<br/>সেট করুন</h1><p>অ্যাকাউন্টের জন্য একটি নিরাপদ নতুন পাসওয়ার্ড বেছে নিন।</p></div></aside><section class="login-card-wrap"><form class="login-card" id="password-recovery-form"><h2>পাসওয়ার্ড পরিবর্তন</h2><p>${esc(currentUser?.email || '')}</p><div class="field"><label>নতুন পাসওয়ার্ড</label><input type="password" name="password" autocomplete="new-password" minlength="8" required /></div><div class="field"><label>পাসওয়ার্ড আবার লিখুন</label><input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></div><button class="btn btn-primary" type="submit" style="width:100%">পাসওয়ার্ড সংরক্ষণ করুন</button></form></section></div>`;
}

function navMarkup() {
  let lastGroup = '';
  return NAV.map(item => {
    let label = '';
    if (item.group && item.group !== lastGroup) { label = `<div class="nav-label">${esc(item.group)}</div>`; lastGroup = item.group; }
    return `${label}<button class="nav-item${currentPage === item.id ? ' active' : ''}" data-page="${item.id}"><span class="nav-icon">${item.icon}</span>${item.label}</button>`;
  }).join('');
}

function renderApp() {
  const page = NAV.find(x => x.id === currentPage) || NAV[0];
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#dashboard" data-page="dashboard"><span class="brand-mark">✦</span><span class="brand-copy"><strong>${esc(db.settings.schoolName)}</strong><span>স্কুল ম্যানেজমেন্ট</span></span></a>
        <nav class="side-nav">${navMarkup()}</nav>
        <div class="sidebar-bottom"><div class="sidebar-note"><strong>${esc(db.settings.session)}</strong>আপনার বিদ্যালয়ের তথ্য এখানে নিরাপদে গুছিয়ে রাখুন।</div><button class="btn sidebar-logout" data-action="logout">↪ &nbsp; লগআউট</button></div>
      </aside>
      <section class="main-column">
        <header class="topbar"><div class="topbar-left"><button class="btn-icon mobile-menu" data-action="menu" aria-label="মেনু">☰</button><span class="crumb">প্রশাসন &nbsp;›&nbsp; <strong>${page.label}</strong></span></div>
          <div class="topbar-tools"><label class="search-box"><span class="search-symbol">⌕</span><input id="global-search" type="search" placeholder="এই পাতায় খুঁজুন..." value="${esc(searchText)}" aria-label="খুঁজুন" /></label><span class="topbar-date">${prettyDate(localDateISO())}</span><div class="user-chip"><span class="avatar">${esc(initials(currentProfile?.display_name || 'অ্যাডমিন'))}</span><span class="user-meta"><strong>${esc(currentProfile?.display_name || 'অ্যাডমিন')}</strong><span>সুপার অ্যাডমিন</span></span></div><button class="btn btn-outline btn-small" type="button" data-action="logout" aria-label="অ্যাকাউন্ট থেকে লগআউট">লগআউট ↪</button></div>
        </header>
        <main class="content" id="page-content">${renderCurrentPage()}</main>
      </section>
    </div>`;
}

function pageHead(title, description, actions = '') {
  return `<div class="page-head"><div><h1>${title}</h1><p>${description}</p></div><div class="page-actions">${actions}</div></div>`;
}
function actionButtons(type, id) {
  return `<div class="table-actions"><button class="table-action" title="সম্পাদনা" aria-label="সম্পাদনা" data-action="edit" data-type="${type}" data-id="${id}">✎</button><button class="table-action delete" title="মুছুন" aria-label="মুছুন" data-action="delete" data-type="${type}" data-id="${id}">⌫</button></div>`;
}
function avatarCell(name, detail = '') { return `<div class="person-cell"><span class="avatar">${esc(initials(name))}</span><span><strong>${esc(name)}</strong>${detail ? `<span>${esc(detail)}</span>` : ''}</span></div>`; }
function badge(text, cls = 'gray') { return `<span class="badge badge-${cls}">${esc(text)}</span>`; }
function emptyRow(cols, title = 'তথ্য পাওয়া যায়নি', sub = 'নতুন তথ্য যোগ করলে এখানে দেখা যাবে।') { return `<tr><td colspan="${cols}"><div class="empty-state"><strong>${title}</strong>${sub}</div></td></tr>`; }
function exportButton(type, label = 'CSV ডাউনলোড') { return `<button class="btn btn-outline btn-small" data-export="${type}">⇩ ${label}</button>`; }

function renderCurrentPage() {
  switch (currentPage) {
    case 'students': return renderStudents();
    case 'teachers': return renderTeachers();
    case 'classes': return renderClasses();
    case 'attendance': return renderAttendance();
    case 'fees': return renderFees();
    case 'notices': return renderNotices();
    case 'documents': return renderDocuments();
    case 'settings': return renderSettings();
    default: return renderDashboard();
  }
}

function renderDashboard() {
  const totalStudents = db.students.length;
  const today = db.attendance[localDateISO()] || {};
  const present = Object.values(today).filter(x => x === 'present').length;
  const absent = Math.max(0, totalStudents - present);
  const ratio = totalStudents ? Math.round(present / totalStudents * 100) : 0;
  const received = db.fees.reduce((sum, f) => sum + Number(f.paid || 0), 0);
  const due = db.fees.reduce((sum, f) => sum + Math.max(0, Number(f.due || 0) - Number(f.paid || 0)), 0);
  const latest = [...db.students].slice(-5).reverse();
  const lastDays = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
  const bars = lastDays.map(date => {
    const record = db.attendance[date] || {};
    const count = Object.values(record).filter(x => x === 'present').length;
    const value = db.students.length ? Math.round(count / db.students.length * 100) : 0;
    return `<div class="chart-col"><div class="chart-bar" style="height:${Math.max(4,value)}%" title="${bn(value)}%"></div><span>${prettyDate(date,{day:'numeric',month:'short'})}</span></div>`;
  }).join('');
  const notices = [...db.notices].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 3);
  return `${pageHead('সুপ্রভাত, প্রশাসক 👋', `${esc(db.settings.schoolName)}-এর আজকের সারসংক্ষেপ`, `<button class="btn btn-outline btn-small" data-export="backup">⇩ ব্যাকআপ</button>`)}
    <div class="stat-grid">
      <article class="stat-card"><div class="stat-card-top"><span>মোট শিক্ষার্থী</span><span class="stat-symbol">♙</span></div><div class="stat-value">${bn(totalStudents)}</div><div class="stat-foot"><span class="good">● সক্রিয়</span> শিক্ষার্থীর তথ্য</div></article>
      <article class="stat-card"><div class="stat-card-top"><span>শিক্ষক ও কর্মী</span><span class="stat-symbol">♧</span></div><div class="stat-value">${bn(db.teachers.length)}</div><div class="stat-foot">শিক্ষাদানে নিয়োজিত</div></article>
      <article class="stat-card"><div class="stat-card-top"><span>আজ উপস্থিত</span><span class="stat-symbol">✓</span></div><div class="stat-value">${bn(present)} <span style="font-size:13px;color:#86938b;font-weight:500">/ ${bn(totalStudents)}</span></div><div class="stat-foot">উপস্থিতির হার ${bn(ratio)}%</div></article>
      <article class="stat-card"><div class="stat-card-top"><span>বকেয়া ফি</span><span class="stat-symbol">৳</span></div><div class="stat-value" style="font-size:22px">${money(due)}</div><div class="stat-foot">এই রেকর্ডে আদায় ${money(received)}</div></article>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>আজকের উপস্থিতি</h2><p>${prettyDate(localDateISO())} • সব শ্রেণি</p></div><button class="btn btn-outline btn-small" data-page="attendance">উপস্থিতি নিন →</button></div><div class="panel-body"><div class="attendance-summary"><div class="donut" style="--ratio:${ratio}%"><div class="donut-center"><strong>${bn(ratio)}%</strong><span>উপস্থিত</span></div></div><div class="legend"><div class="legend-row"><i class="legend-dot"></i>উপস্থিত <strong>${bn(present)}</strong></div><div class="legend-row"><i class="legend-dot gray"></i>অনুপস্থিত <strong>${bn(absent)}</strong></div><div class="legend-row">মোট শিক্ষার্থী <strong>${bn(totalStudents)}</strong></div></div></div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>সাম্প্রতিক নোটিশ</h2><p>প্রকাশিত ঘোষণা</p></div><button class="btn btn-quiet btn-small" data-page="notices">সব দেখুন →</button></div><div class="panel-body"><div class="quick-list">${notices.length ? notices.map(n => `<div class="quick-item"><div class="quick-date">${shortDate(n.date)}</div><div class="quick-copy"><strong>${esc(n.title)}</strong><span>${esc(n.type || 'ঘোষণা')}</span></div></div>`).join('') : '<div class="empty-state">কোনো নোটিশ নেই</div>'}</div></div></section>
    </div>
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h2>সাপ্তাহিক উপস্থিতির হার</h2><p>গত সাত দিনের শ্রেণি উপস্থিতি</p></div><span class="badge badge-green">৭ দিন</span></div><div class="panel-body"><div class="chart-bars">${bars}</div></div></section>
      <section class="panel"><div class="panel-head"><div><h2>দ্রুত কাজ</h2><p>প্রতিদিনের ব্যবস্থাপনা</p></div></div><div class="panel-body"><div class="quick-list"><button class="nav-item" data-page="students">♙ &nbsp; নতুন শিক্ষার্থী যোগ করুন</button><button class="nav-item" data-page="attendance">✓ &nbsp; আজকের উপস্থিতি নিন</button><button class="nav-item" data-page="notices">▣ &nbsp; নতুন নোটিশ প্রকাশ করুন</button><button class="nav-item" data-page="documents">▧ &nbsp; নথি আপলোড করুন</button></div></div></section>
    </div>
    <section class="panel"><div class="panel-head"><div><h2>সাম্প্রতিক ভর্তি</h2><p>সর্বশেষ যুক্ত শিক্ষার্থীরা</p></div><button class="btn btn-outline btn-small" data-page="students">সব শিক্ষার্থী →</button></div><div class="table-wrap"><table><thead><tr><th>শিক্ষার্থী</th><th>শ্রেণি</th><th>রোল</th><th>অভিভাবক</th><th>অবস্থা</th></tr></thead><tbody>${latest.length ? latest.map(s => `<tr><td>${avatarCell(s.name, `আইডি: ${s.id.toUpperCase()}`)}</td><td>${esc(studentClassName(s))}</td><td>${bn(s.roll)}</td><td>${esc(s.guardian)}</td><td>${badge(s.status || 'সক্রিয়','green')}</td></tr>`).join('') : emptyRow(5)}</tbody></table></div></section>`;
}

function filtered(items, fields) {
  const q = searchText.trim().toLocaleLowerCase('bn');
  return q ? items.filter(item => fields.some(field => String(item[field] || '').toLocaleLowerCase('bn').includes(q))) : items;
}

function renderStudents() {
  const list = filtered(db.students, ['name','guardian','phone','roll']).filter(s => !searchText || studentClassName(s).toLocaleLowerCase('bn').includes(searchText.toLocaleLowerCase('bn')));
  const rows = list.map(s => `<tr><td>${avatarCell(s.name, `আইডি: ${s.id.toUpperCase()}`)}</td><td>${esc(studentClassName(s))}</td><td>${bn(s.roll)}</td><td>${esc(s.guardian)}</td><td>${esc(s.phone)}</td><td>${badge(s.status || 'সক্রিয়',s.status === 'সক্রিয়' ? 'green' : 'gray')}</td><td>${actionButtons('students',s.id)}</td></tr>`).join('');
  return `${pageHead('শিক্ষার্থী ব্যবস্থাপনা', `মোট ${bn(db.students.length)} জন শিক্ষার্থীর তথ্য`, `${exportButton('students')}<button class="btn btn-primary btn-small" data-action="add" data-type="students">＋ শিক্ষার্থী যোগ</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>শিক্ষার্থীর তালিকা</h2><p>নাম, শ্রেণি, অভিভাবক ও যোগাযোগের তথ্য</p></div><span class="badge badge-gray">${bn(list.length)} জন</span></div><div class="table-wrap"><table><thead><tr><th>শিক্ষার্থী</th><th>শ্রেণি</th><th>রোল</th><th>অভিভাবক</th><th>ফোন</th><th>অবস্থা</th><th></th></tr></thead><tbody>${rows || emptyRow(7,'শিক্ষার্থী পাওয়া যায়নি')}</tbody></table></div></section>`;
}

function renderTeachers() {
  const list = filtered(db.teachers,['name','subject','phone','email']);
  const rows = list.map(t => `<tr><td>${avatarCell(t.name, 'শিক্ষক')}</td><td>${esc(t.subject)}</td><td>${esc(t.phone)}</td><td>${esc(t.email)}</td><td>${actionButtons('teachers',t.id)}</td></tr>`).join('');
  return `${pageHead('শিক্ষক ও কর্মী', `মোট ${bn(db.teachers.length)} জন শিক্ষক-কর্মীর তথ্য`, `${exportButton('teachers')}<button class="btn btn-primary btn-small" data-action="add" data-type="teachers">＋ শিক্ষক যোগ</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>শিক্ষক তালিকা</h2><p>যোগাযোগ ও বিষয়ের তথ্য</p></div><span class="badge badge-gray">${bn(list.length)} জন</span></div><div class="table-wrap"><table><thead><tr><th>নাম</th><th>বিষয়</th><th>ফোন</th><th>ইমেইল</th><th></th></tr></thead><tbody>${rows || emptyRow(5,'শিক্ষক পাওয়া যায়নি')}</tbody></table></div></section>`;
}

function renderClasses() {
  const q = searchText.toLocaleLowerCase('bn');
  const list = db.classes.filter(c => !q || `${c.name} ${c.teacher} ${c.room}`.toLocaleLowerCase('bn').includes(q));
  const rows = list.map(c => {
    const count = db.students.filter(s => s.classId === c.id).length;
    return `<tr><td><strong style="color:var(--green-950)">${esc(c.name)}</strong></td><td>${esc(c.teacher || 'নির্ধারিত নয়')}</td><td>${esc(c.room || '—')}</td><td>${bn(count)} জন</td><td>${actionButtons('classes',c.id)}</td></tr>`;
  }).join('');
  return `${pageHead('শ্রেণি ও বিভাগ', `${bn(db.classes.length)}টি শ্রেণির তথ্য ও শিক্ষার্থী সংখ্যা`, `${exportButton('classes')}<button class="btn btn-primary btn-small" data-action="add" data-type="classes">＋ শ্রেণি যোগ</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>শ্রেণির তালিকা</h2><p>শ্রেণিশিক্ষক ও কক্ষের তথ্য</p></div><span class="badge badge-gray">${bn(list.length)}টি</span></div><div class="table-wrap"><table><thead><tr><th>শ্রেণি</th><th>শ্রেণিশিক্ষক</th><th>কক্ষ</th><th>শিক্ষার্থী</th><th></th></tr></thead><tbody>${rows || emptyRow(5,'শ্রেণি পাওয়া যায়নি')}</tbody></table></div></section>`;
}

function renderAttendance() {
  const todayRecord = db.attendance[attendanceDate] || {};
  const q = searchText.toLocaleLowerCase('bn');
  const students = db.students.filter(s => !q || `${s.name} ${s.guardian} ${s.roll} ${studentClassName(s)}`.toLocaleLowerCase('bn').includes(q));
  const present = Object.values(todayRecord).filter(s => s === 'present').length;
  const absent = Object.values(todayRecord).filter(s => s === 'absent').length;
  const rows = students.map(s => {
    const status = todayRecord[s.id] || 'unmarked';
    return `<tr><td>${avatarCell(s.name,`রোল ${bn(s.roll)}`)}</td><td>${esc(studentClassName(s))}</td><td>${esc(s.guardian)}</td><td><select class="attendance-select" data-attendance="${s.id}" aria-label="${esc(s.name)}-এর উপস্থিতি"><option value="unmarked" ${status==='unmarked'?'selected':''}>চিহ্নিত নয়</option><option value="present" ${status==='present'?'selected':''}>উপস্থিত</option><option value="absent" ${status==='absent'?'selected':''}>অনুপস্থিত</option></select></td></tr>`;
  }).join('');
  return `${pageHead('দৈনিক উপস্থিতি', 'শিক্ষার্থীদের উপস্থিতি নিন ও সংরক্ষণ করুন', `${exportButton('attendance')}<button class="btn btn-outline btn-small" data-action="mark-all-present">সবাই উপস্থিত</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>উপস্থিতির খাতা</h2><p>${prettyDate(attendanceDate)} • উপস্থিত ${bn(present)} • অনুপস্থিত ${bn(absent)}</p></div><div class="filter-row"><input class="attendance-select" id="attendance-date" type="date" value="${attendanceDate}" aria-label="তারিখ" /></div></div><div class="table-wrap"><table><thead><tr><th>শিক্ষার্থী</th><th>শ্রেণি</th><th>অভিভাবক</th><th>অবস্থা</th></tr></thead><tbody>${rows || emptyRow(4,'শিক্ষার্থী পাওয়া যায়নি')}</tbody></table></div></section>`;
}

function renderFees() {
  const q = searchText.toLocaleLowerCase('bn');
  const list = [...db.fees].filter(f => {
    const s = getStudent(f.studentId);
    return !q || `${s?.name || ''} ${f.month} ${studentClassName(s || {})}`.toLocaleLowerCase('bn').includes(q);
  }).sort((a,b) => (getStudent(a.studentId)?.name || '').localeCompare(getStudent(b.studentId)?.name || '','bn'));
  const collected = db.fees.reduce((a,f) => a + Number(f.paid || 0),0);
  const outstanding = db.fees.reduce((a,f) => a + Math.max(0,Number(f.due || 0)-Number(f.paid || 0)),0);
  const rows = list.map(f => {
    const s = getStudent(f.studentId);
    const state = Number(f.paid) >= Number(f.due) ? badge('পরিশোধিত','green') : Number(f.paid) > 0 ? badge('আংশিক','amber') : badge('বকেয়া','red');
    return `<tr><td>${avatarCell(s?.name || 'শিক্ষার্থী মুছে ফেলা হয়েছে',s ? studentClassName(s) : '')}</td><td>${esc(f.month)}</td><td>${money(f.due)}</td><td>${money(f.paid)}</td><td>${state}</td><td>${actionButtons('fees',f.id)}</td></tr>`;
  }).join('');
  return `${pageHead('বেতন ও ফি', 'ফি রেকর্ড, পরিশোধ ও বকেয়া দেখুন', `${exportButton('fees')}<button class="btn btn-primary btn-small" data-action="add" data-type="fees">＋ ফি রেকর্ড</button>`)}
    <div class="stat-grid"><article class="stat-card"><div class="stat-card-top"><span>এই তালিকায় আদায়</span><span class="stat-symbol">৳</span></div><div class="stat-value" style="font-size:22px">${money(collected)}</div><div class="stat-foot">সব রেকর্ড মিলিয়ে</div></article><article class="stat-card"><div class="stat-card-top"><span>মোট বকেয়া</span><span class="stat-symbol">!</span></div><div class="stat-value" style="font-size:22px">${money(outstanding)}</div><div class="stat-foot">পরিশোধের অপেক্ষায়</div></article></div>
    <section class="panel"><div class="panel-head"><div><h2>ফি রেকর্ড</h2><p>শিক্ষার্থীভিত্তিক মাসিক ফি</p></div><span class="badge badge-gray">${bn(list.length)}টি রেকর্ড</span></div><div class="table-wrap"><table><thead><tr><th>শিক্ষার্থী</th><th>মাস</th><th>ধার্য</th><th>পরিশোধ</th><th>অবস্থা</th><th></th></tr></thead><tbody>${rows || emptyRow(6,'ফি রেকর্ড পাওয়া যায়নি')}</tbody></table></div></section>`;
}

function renderNotices() {
  const q = searchText.toLocaleLowerCase('bn');
  const list = [...db.notices].filter(n => !q || `${n.title} ${n.body} ${n.type}`.toLocaleLowerCase('bn').includes(q)).sort((a,b) => b.date.localeCompare(a.date));
  const rows = list.map(n => `<tr><td><strong style="color:var(--green-950)">${esc(n.title)}</strong><div style="font-size:9px;color:#85928a;margin-top:4px">${esc(n.body.slice(0,92))}${n.body.length>92?'…':''}</div></td><td>${badge(n.type || 'ঘোষণা','green')}</td><td>${prettyDate(n.date)}</td><td>${actionButtons('notices',n.id)}</td></tr>`).join('');
  return `${pageHead('নোটিশ বোর্ড', 'বিদ্যালয়ের ঘোষণা প্রকাশ ও সম্পাদনা করুন', `${exportButton('notices')}<button class="btn btn-primary btn-small" data-action="add" data-type="notices">＋ নোটিশ লিখুন</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>প্রকাশিত নোটিশ</h2><p>পাবলিক স্কুল পাতায় সাম্প্রতিক নোটিশ দেখা যায়</p></div><span class="badge badge-gray">${bn(list.length)}টি</span></div><div class="table-wrap"><table><thead><tr><th>বিষয়</th><th>ধরন</th><th>তারিখ</th><th></th></tr></thead><tbody>${rows || emptyRow(4,'কোনো নোটিশ নেই')}</tbody></table></div></section>`;
}

function renderDocuments() {
  const q = searchText.toLocaleLowerCase('bn');
  const list = [...db.documents].filter(d => !q || `${d.name} ${d.category} ${d.note || ''}`.toLocaleLowerCase('bn').includes(q)).sort((a,b) => b.uploadedAt.localeCompare(a.uploadedAt));
  const rows = list.map(d => `<tr><td><div class="person-cell"><span class="avatar">▧</span><span><strong>${esc(d.name)}</strong><span>${esc(d.note || 'বিদ্যালয়ের নথি')}</span></span></div></td><td>${badge(d.category || 'সাধারণ','gray')}</td><td>${prettyDate(d.uploadedAt)}</td><td>${bn(Math.ceil(d.size/1024))} KB</td><td><div class="table-actions"><button class="table-action" title="ডাউনলোড" data-action="download-doc" data-id="${d.id}">⇩</button><button class="table-action delete" title="মুছুন" data-action="delete" data-type="documents" data-id="${d.id}">⌫</button></div></td></tr>`).join('');
  return `${pageHead('ডিজিটাল নথি', 'প্রয়োজনীয় ফাইল আপলোড, সংরক্ষণ ও ডাউনলোড করুন', `${exportButton('documents')}<button class="btn btn-primary btn-small" data-action="upload-docs">＋ নথি আপলোড</button>`)}
    <section class="panel"><div class="panel-head"><div><h2>নথির সংগ্রহ</h2><p>PDF, ছবি, Word ও Excel ফাইল • প্রতি ফাইল সর্বোচ্চ ১০ MB</p></div><span class="badge badge-gray">${bn(list.length)}টি ফাইল</span></div>
      ${list.length ? `<div class="table-wrap"><table><thead><tr><th>ফাইল</th><th>ধরন</th><th>আপলোড</th><th>আকার</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="panel-body"><div class="upload-zone"><div class="file-icon">⇧</div><strong>ডিজিটাল নথি এখানে গুছিয়ে রাখুন</strong><p>PDF, ছবি, Word বা Excel ফাইল বেছে নিন (সর্বোচ্চ ১০ MB/ফাইল)।</p><button class="btn btn-outline btn-small" data-action="upload-docs">ফাইল বেছে নিন</button></div></div>`}
      <input id="document-files" class="hidden" type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp" />
      <div style="padding:12px 18px;color:#819087;font-size:10px;border-top:1px solid var(--line)">ফাইলগুলো ব্যক্তিগত cloud storage-এ থাকে এবং অ্যাডমিন লগইন ছাড়া দেখা যায় না।</div>
    </section>`;
}

function renderSettings() {
  return `${pageHead('সেটিংস ও ব্যাকআপ', 'বিদ্যালয়ের পরিচিতি, অ্যাডমিন অ্যাকাউন্ট ও ডেটা পরিচালনা করুন')}
    <div class="settings-grid">
      <section class="panel"><div class="panel-head"><div><h2>বিদ্যালয়ের তথ্য</h2><p>পাবলিক পাতায় এই তথ্য দেখানো হবে</p></div></div><div class="panel-body"><form id="school-settings-form"><div class="field"><label>বিদ্যালয়ের নাম</label><input name="schoolName" required value="${esc(db.settings.schoolName)}" /></div><div class="field"><label>বিদ্যালয়ের মূলমন্ত্র</label><input name="motto" value="${esc(db.settings.motto)}" /></div><div class="form-grid"><div class="field"><label>শিক্ষাবর্ষ</label><input name="session" value="${esc(db.settings.session)}" /></div><div class="field"><label>যোগাযোগের ফোন</label><input name="phone" value="${esc(db.settings.phone)}" /></div></div><div class="form-grid"><div class="field"><label>ইমেইল</label><input name="email" type="email" value="${esc(db.settings.email)}" /></div><div class="field"><label>ঠিকানা</label><input name="address" value="${esc(db.settings.address)}" /></div></div><button class="btn btn-primary btn-small" type="submit">তথ্য সংরক্ষণ</button></form></div></section>
      <div style="display:grid;gap:16px">
        <section class="panel"><div class="panel-head"><div><h2>অ্যাডমিন পাসওয়ার্ড</h2><p>${esc(currentUser?.email || '')}</p></div></div><div class="panel-body"><form id="password-form"><div class="field"><label>নতুন পাসওয়ার্ড</label><input type="password" name="newPassword" autocomplete="new-password" minlength="8" required /><small>কমপক্ষে ৮ অক্ষর।</small></div><div class="field"><label>নতুন পাসওয়ার্ড আবার লিখুন</label><input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required /></div><button class="btn btn-primary btn-small" type="submit">পাসওয়ার্ড বদলান</button></form></div></section>
        <section class="panel"><div class="panel-head"><div><h2>ডেটা ব্যাকআপ</h2><p>স্কুলের রেকর্ড JSON ফাইলে সংরক্ষণ বা পুনরুদ্ধার করুন</p></div></div><div class="panel-body"><div class="settings-note"><strong>তথ্য cloud database-এ সিঙ্ক হয়</strong>এখান থেকে JSON রেকর্ড ডাউনলোড করে কপি রাখুন। ফাইলের নথি আলাদাভাবে download করুন।</div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn btn-outline btn-small" data-export="backup">⇩ ব্যাকআপ ডাউনলোড</button><button class="btn btn-outline btn-small" data-action="restore">⇧ ব্যাকআপ থেকে যোগ করুন</button><input id="restore-file" type="file" class="hidden" accept="application/json,.json" /></div></div></section>
      </div>
    </div>
    <div class="settings-note" style="margin-top:16px"><strong>নিরাপদ প্রবেশ</strong>স্কুলের ব্যক্তিগত তথ্য শুধু অ্যাডমিন লগইনের মাধ্যমে দেখা ও পরিবর্তন করা যায়।</div>`;
}

function classOptions(selected = '') {
  return db.classes.map(c => `<option value="${c.id}" ${selected===c.id?'selected':''}>${esc(c.name)}</option>`).join('');
}
function studentOptions(selected = '') {
  return [...db.students].sort((a,b) => a.name.localeCompare(b.name,'bn')).map(s => `<option value="${s.id}" ${selected===s.id?'selected':''}>${esc(s.name)} — ${esc(studentClassName(s))}</option>`).join('');
}
function field(label, name, value = '', type = 'text', attrs = '') {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs} /></div>`;
}
function selectField(label,name,options,value='') {
  return `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}" required>${options}</select></div>`;
}

function openEntityModal(type, id = '') {
  const edit = Boolean(id);
  const titles = { students:['শিক্ষার্থী', 'নতুন শিক্ষার্থীর তথ্য দিন'], teachers:['শিক্ষক', 'শিক্ষকের যোগাযোগের তথ্য দিন'], classes:['শ্রেণি', 'শ্রেণির তথ্য দিন'], fees:['ফি রেকর্ড', 'শিক্ষার্থীর মাসিক ফি যোগ করুন'], notices:['নোটিশ', 'বিদ্যালয়ের ঘোষণা লিখুন'] };
  const source = edit ? db[type].find(x => x.id === id) : {};
  if (edit && !source) return;
  let fields = '';
  if (type === 'students') fields = `${field('শিক্ষার্থীর নাম','name',source.name || '','text','required')}${field('অভিভাবকের নাম','guardian',source.guardian || '','text','required')}<div class="form-grid">${selectField('শ্রেণি','classId',classOptions(source.classId || ''))}${field('রোল নম্বর','roll',source.roll || '','number','min="1" required')}</div><div class="form-grid">${field('মোবাইল নম্বর','phone',source.phone || '','tel','required')}${field('ভর্তির তারিখ','admission',source.admission || localDateISO(),'date','required')}</div>`;
  if (type === 'teachers') fields = `${field('শিক্ষকের নাম','name',source.name || '','text','required')}<div class="form-grid">${field('পাঠদানের বিষয়','subject',source.subject || '','text','required')}${field('মোবাইল নম্বর','phone',source.phone || '','tel','required')}</div>${field('ইমেইল','email',source.email || '','email')}`;
  if (type === 'classes') fields = `${field('শ্রেণির নাম','name',source.name || '','text','required')}<div class="form-grid">${field('শ্রেণিশিক্ষক','teacher',source.teacher || '','text')}${field('কক্ষ নম্বর','room',source.room || '','text')}</div>`;
  if (type === 'fees') fields = `${selectField('শিক্ষার্থী','studentId',studentOptions(source.studentId || ''))}<div class="form-grid">${field('মাস/খাত','month',source.month || `${new Intl.DateTimeFormat('bn-BD',{month:'long',year:'numeric'}).format(new Date())}`,'text','required')}${field('ধার্য ফি (টাকা)','due',source.due ?? 500,'number','min="0" required')}</div><div class="form-grid">${field('পরিশোধিত (টাকা)','paid',source.paid ?? 0,'number','min="0" required')}${field('পরিশোধের তারিখ','date',source.date || localDateISO(),'date')}</div>`;
  if (type === 'notices') fields = `${field('নোটিশের শিরোনাম','title',source.title || '','text','required')}<div class="form-grid">${field('প্রকাশের তারিখ','date',source.date || localDateISO(),'date','required')}${selectField('ধরন','type',['ঘোষণা','পরীক্ষা','অনুষ্ঠান','সভা','ছুটি','অন্যান্য'].map(x=>`<option ${source.type===x?'selected':''}>${x}</option>`).join(''))}</div><div class="field"><label for="f-body">বিস্তারিত</label><textarea id="f-body" name="body" required>${esc(source.body || '')}</textarea></div>`;
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close="true"><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${edit?'তথ্য সম্পাদনা':'নতুন'} ${titles[type][0]}</h2><p>${titles[type][1]}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="বন্ধ">×</button></div><form id="entity-form" data-type="${type}" data-id="${id}">${fields}<div class="modal-footer"><button class="btn btn-quiet" type="button" data-action="close-modal">বাতিল</button><button class="btn btn-primary" type="submit">${edit?'পরিবর্তন সংরক্ষণ':'তথ্য সংরক্ষণ'}</button></div></form></section></div>`;
  modalRoot.querySelector('input,select,textarea')?.focus();
}

async function saveEntity(form) {
  const type = form.dataset.type;
  const id = form.dataset.id;
  const values = Object.fromEntries(new FormData(form).entries());
  const table = ({ fees:'fee_records' })[type] || type;
  let item = { ...values, school_id:currentProfile.school_id };
  if (type === 'students') item = { ...item, class_id:values.classId || null, roll:Number(values.roll), phone:normalizePhone(values.phone), status:id ? (db.students.find(x=>x.id===id)?.status || 'সক্রিয়') : 'সক্রিয়' };
  if (type === 'teachers') item.phone = normalizePhone(item.phone);
  if (type === 'fees') item = { ...item, student_id:values.studentId, amount_due:Number(values.due), amount_paid:Number(values.paid), paid_at:values.date || null };
  if (type === 'notices') item.is_published = true;
  ['classId','studentId','due','paid','date'].forEach(key => delete item[key]);
  const result = id ? await dbClient.from(table).update(item).eq('id', id) : await dbClient.from(table).insert(item);
  if (result.error) { toast(backendError(result.error), true); return; }
  modalRoot.innerHTML = '';
  await refreshData(id ? 'তথ্য হালনাগাদ হয়েছে।' : 'নতুন তথ্য যোগ হয়েছে।');
}

async function deleteEntity(type, id) {
  if (type === 'classes' && db.students.some(s => s.classId === id)) {
    toast('এই শ্রেণিতে শিক্ষার্থী আছে। আগে শিক্ষার্থীদের অন্য শ্রেণিতে স্থানান্তর করুন।', true);
    return;
  }
  const labels = { students:'শিক্ষার্থী', teachers:'শিক্ষক', classes:'শ্রেণি', fees:'ফি রেকর্ড', notices:'নোটিশ', documents:'নথি' };
  if (!window.confirm(`এই ${labels[type] || 'তথ্য'} মুছে ফেলবেন?`)) return;
  if (type === 'documents') {
    const doc = db.documents.find(x => x.id === id);
    const { error: storageError } = await dbClient.storage.from('school-documents').remove([doc.storagePath]);
    if (storageError) return toast(backendError(storageError), true);
  }
  const table = ({ fees:'fee_records' })[type] || type;
  const { error } = await dbClient.from(table).delete().eq('id', id);
  if (error) return toast(backendError(error), true);
  await refreshData('তথ্য মুছে ফেলা হয়েছে।');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportJSON() {
  const backup = {
    format:'school-management-backup-v1', exportedAt:new Date().toISOString(), school:db.settings,
    classes:db.classes, students:db.students, teachers:db.teachers,
    attendance:Object.entries(db.attendance).flatMap(([date, values]) => Object.entries(values).map(([studentId,status]) => ({ studentId, date, status }))),
    fees:db.fees, notices:db.notices.map(({ id,title,date,type,body }) => ({ id,title,date,type,body }))
  };
  const file = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  downloadBlob(file, `school-backup-${localDateISO()}.json`);
  toast('JSON ব্যাকআপ ডাউনলোড হচ্ছে।');
}
function csvSafe(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g,'""')}"`;
}
function exportCSV(type) {
  let headers = [], rows = [];
  if (type === 'students') { headers=['শিক্ষার্থী','শ্রেণি','রোল','অভিভাবক','ফোন','ভর্তির তারিখ','অবস্থা']; rows=db.students.map(s=>[s.name,studentClassName(s),s.roll,s.guardian,s.phone,s.admission,s.status]); }
  if (type === 'teachers') { headers=['নাম','বিষয়','ফোন','ইমেইল']; rows=db.teachers.map(t=>[t.name,t.subject,t.phone,t.email]); }
  if (type === 'classes') { headers=['শ্রেণি','শ্রেণিশিক্ষক','কক্ষ','শিক্ষার্থী সংখ্যা']; rows=db.classes.map(c=>[c.name,c.teacher,c.room,db.students.filter(s=>s.classId===c.id).length]); }
  if (type === 'attendance') { headers=['তারিখ','শিক্ষার্থী','শ্রেণি','রোল','উপস্থিতি']; rows=db.students.map(s=>[attendanceDate,s.name,studentClassName(s),s.roll,(db.attendance[attendanceDate]||{})[s.id]==='present'?'উপস্থিত':(db.attendance[attendanceDate]||{})[s.id]==='absent'?'অনুপস্থিত':'চিহ্নিত নয়']); }
  if (type === 'fees') { headers=['শিক্ষার্থী','শ্রেণি','মাস','ধার্য','পরিশোধ','বকেয়া']; rows=db.fees.map(f=>{const s=getStudent(f.studentId);return[s?.name||'মুছে ফেলা',s?studentClassName(s):'',f.month,f.due,f.paid,Math.max(0,f.due-f.paid)]}); }
  if (type === 'notices') { headers=['শিরোনাম','ধরন','তারিখ','বিস্তারিত']; rows=db.notices.map(n=>[n.title,n.type,n.date,n.body]); }
  if (type === 'documents') { headers=['ফাইল','ধরন','আপলোডের তারিখ','আকার (বাইট)']; rows=db.documents.map(d=>[d.name,d.category,d.uploadedAt,d.size]); }
  const content = '\ufeff' + [headers,...rows].map(row=>row.map(csvSafe).join(',')).join('\r\n');
  downloadBlob(new Blob([content],{type:'text/csv;charset=utf-8'}),`${type}-${localDateISO()}.csv`);
  toast('CSV ফাইল ডাউনলোড হচ্ছে।');
}

async function storeDocuments(files) {
  const allowed = /\.(pdf|doc|docx|xls|xlsx|png|jpe?g|webp)$/i;
  let added = 0;
  for (const file of files) {
    if (!allowed.test(file.name)) { toast(`${file.name}: এই ফাইলের ধরন সমর্থিত নয়।`, true); continue; }
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name}: ফাইলটি ১০ MB-এর চেয়ে বড়।`, true); continue; }
    try {
      const safeName = file.name.replace(/[^\p{L}\p{N}._-]+/gu, '_');
      const path = `${currentProfile.school_id}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await dbClient.storage.from('school-documents').upload(path, file, { contentType:file.type || 'application/octet-stream', upsert:false });
      if (uploadError) throw uploadError;
      const { error: rowError } = await dbClient.from('documents').insert({ school_id:currentProfile.school_id, name:file.name, category:file.type.startsWith('image/') ? 'ছবি' : file.name.split('.').pop().toUpperCase(), note:'', storage_path:path, size_bytes:file.size, mime_type:file.type || 'application/octet-stream' });
      if (rowError) {
        await dbClient.storage.from('school-documents').remove([path]);
        throw rowError;
      }
      added++;
    } catch (e) { toast(`${file.name}: ${backendError(e)}`, true); }
  }
  if (added) await refreshData(`${bn(added)}টি নথি সংরক্ষণ হয়েছে।`);
}
async function downloadDocument(id) {
  const doc = db.documents.find(d => d.id === id);
  if (!doc) return toast('নথিটি পাওয়া যায়নি।', true);
  const { data, error } = await dbClient.storage.from('school-documents').createSignedUrl(doc.storagePath, 60, { download:doc.name });
  if (error) return toast(backendError(error), true);
  const a = document.createElement('a'); a.href = data.signedUrl; a.target = '_blank'; a.rel = 'noopener'; a.download = doc.name; a.click();
}

function handleExport(type) {
  if (type === 'backup') exportJSON();
  else exportCSV(type);
}

async function handleSubmit(event) {
  const form = event.target;
  if (!form.matches('form')) return;
  event.preventDefault();
  if (form.id === 'login-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    const { data, error } = await dbClient.auth.signInWithPassword({ email:String(values.email).trim().toLowerCase(), password:String(values.password) });
    if (error) return toast(backendError(error), true);
    currentUser = data.user;
    try {
      await loadProfile();
      if (isLoggedIn()) { await loadSchoolData(); currentPage='dashboard'; render(); toast('স্বাগতম, ' + currentProfile.display_name + '।'); }
      else render();
    } catch (e) { toast(backendError(e), true); }
    return;
  }
  if (form.id === 'signup-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    const { data, error } = await dbClient.auth.signUp({ email:String(values.email).trim().toLowerCase(), password:String(values.password), options:{ data:{ display_name:String(values.displayName).trim() } } });
    if (error) return toast(backendError(error), true);
    if (data.session && data.user) { currentUser=data.user; currentProfile=null; render(); toast('অ্যাকাউন্ট তৈরি হয়েছে। এখন একবারের সেটআপ কী দিন।'); }
    else { authMode='login'; render(); toast('অ্যাকাউন্ট তৈরি হয়েছে। ইমেইলে পাঠানো লিংক নিশ্চিত করে লগইন করুন।'); }
    return;
  }
  if (form.id === 'admin-setup-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    const { error } = await dbClient.rpc('claim_school_admin', { p_token:String(values.setupKey).trim(), p_display_name:String(values.displayName).trim() });
    if (error) return toast(backendError(error), true);
    try { await loadProfile(); await loadSchoolData(); currentPage='dashboard'; render(); toast('অ্যাডমিন সেটআপ সম্পন্ন হয়েছে।'); }
    catch (e) { toast(backendError(e), true); }
    return;
  }
  if (form.id === 'password-recovery-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    if (String(values.password).length < 8) return toast('পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', true);
    if (values.password !== values.confirmPassword) return toast('পাসওয়ার্ড দুটি মিলছে না।', true);
    const { error } = await dbClient.auth.updateUser({ password:String(values.password) });
    if (error) return toast(backendError(error), true);
    passwordRecovery=false;
    try { await loadProfile(); if (isLoggedIn()) { await loadSchoolData(); currentPage='dashboard'; } else currentPage='login'; render(); toast('পাসওয়ার্ড বদলানো হয়েছে।'); }
    catch (e) { toast(backendError(e), true); }
    return;
  }
  if (form.id === 'entity-form') { await saveEntity(form); return; }
  if (form.id === 'school-settings-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    const payload = { name:values.schoolName, motto:values.motto, session:values.session, phone:values.phone, email:values.email, address:values.address };
    const { error } = await dbClient.from('schools').update(payload).eq('id', currentProfile.school_id);
    if (error) return toast(backendError(error), true);
    await loadPublicData();
    await refreshData('বিদ্যালয়ের তথ্য সংরক্ষণ হয়েছে।');
    return;
  }
  if (form.id === 'password-form') {
    const values = Object.fromEntries(new FormData(form).entries());
    if (String(values.newPassword).length < 8) return toast('নতুন পাসওয়ার্ড কমপক্ষে ৮ অক্ষরের হতে হবে।', true);
    if (values.newPassword !== values.confirmPassword) return toast('নতুন পাসওয়ার্ড দুটি মিলছে না।', true);
    const { error } = await dbClient.auth.updateUser({ password:String(values.newPassword) });
    if (error) return toast(backendError(error), true);
    form.reset(); toast('অ্যাডমিন পাসওয়ার্ড বদলানো হয়েছে।');
  }
}

async function restoreBackup(file) {
  if (!file) return;
  try {
    const contents = JSON.parse(await file.text());
    if (contents?.format !== 'school-management-backup-v1' || !Array.isArray(contents.students) || !Array.isArray(contents.classes)) throw new Error('invalid');
    if (!window.confirm('ব্যাকআপের রেকর্ডগুলো বর্তমান স্কুলের তথ্যের সঙ্গে যোগ/হালনাগাদ করবেন?')) return;
    const school_id = currentProfile.school_id;
    if (contents.school) {
      const s = contents.school;
      const { error } = await dbClient.from('schools').update({ name:s.schoolName, motto:s.motto || '', session:s.session || '', phone:s.phone || '', email:s.email || '', address:s.address || '' }).eq('id', school_id);
      if (error) throw error;
    }
    const upsert = async (table, rows, conflict='id') => {
      if (!rows?.length) return;
      const { error } = await dbClient.from(table).upsert(rows.map(row => ({ ...row, school_id })), { onConflict:conflict });
      if (error) throw error;
    };
    await upsert('classes', contents.classes.map(({ id,name,teacher,room }) => ({ id,name,teacher,room })));
    await upsert('teachers', (contents.teachers || []).map(({ id,name,subject,phone,email }) => ({ id,name,subject,phone,email })));
    await upsert('students', contents.students.map(({ id,name,guardian,classId,roll,phone,admission,status }) => ({ id,name,guardian,class_id:classId || null,roll,phone,admission,status })));
    await upsert('fee_records', (contents.fees || []).map(({ id,studentId,month,due,paid,date }) => ({ id,student_id:studentId,month,amount_due:due,amount_paid:paid,paid_at:date || null })), 'school_id,student_id,month');
    await upsert('attendance', (contents.attendance || []).map(({ studentId,date,status }) => ({ student_id:studentId,attendance_date:date,status })), 'school_id,student_id,attendance_date');
    await upsert('notices', (contents.notices || []).map(({ id,title,date,type,body }) => ({ id,title,date,type,body,is_published:true })));
    await loadPublicData();
    await refreshData('ব্যাকআপের রেকর্ড যোগ হয়েছে। নথির ফাইল আলাদাভাবে আপলোড করতে হবে।');
  } catch (e) { toast('ব্যাকআপ ফাইলটি পড়া যায়নি বা ফরম্যাট সঠিক নয়: ' + backendError(e), true); }
}

async function handleAttendanceChange(select) {
  const id = select.dataset.attendance;
  let result;
  if (select.value === 'unmarked') result = await dbClient.from('attendance').delete().eq('school_id', currentProfile.school_id).eq('student_id', id).eq('attendance_date', attendanceDate);
  else result = await dbClient.from('attendance').upsert({ school_id:currentProfile.school_id, student_id:id, attendance_date:attendanceDate, status:select.value }, { onConflict:'school_id,student_id,attendance_date' });
  if (result.error) return toast(backendError(result.error), true);
  await refreshData();
}

app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action],[data-page],[data-nav],[data-export]');
  if (!target) return;
  if (target.dataset.page) { event.preventDefault(); goTo(target.dataset.page); return; }
  if (target.dataset.nav === 'home') { event.preventDefault(); currentPage='home'; render(); return; }
  if (target.dataset.export) { handleExport(target.dataset.export); return; }
  const action = target.dataset.action;
  if (action === 'login') { currentPage='login'; render(); }
  if (action === 'home') { currentPage='home'; render(); }
  if (action === 'logout') {
    const { error } = await dbClient.auth.signOut();
    if (error) return toast(backendError(error), true);
    currentUser=null; currentProfile=null; passwordRecovery=false; db=emptyDatabase(); currentPage='home'; await loadPublicData().catch(() => {}); render(); toast('নিরাপদে লগআউট হয়েছে।');
  }
  if (action === 'toggle-auth') { authMode = authMode === 'login' ? 'signup' : 'login'; render(); }
  if (action === 'reset-password') {
    const email = window.prompt('আপনার অ্যাকাউন্টের ইমেইল লিখুন:');
    if (!email) return;
    const { error } = await dbClient.auth.resetPasswordForEmail(email.trim(), { redirectTo:window.location.href.split('#')[0] });
    if (error) toast(backendError(error), true); else toast('পাসওয়ার্ড বদলানোর লিংক ইমেইলে পাঠানো হয়েছে।');
  }
  if (action === 'menu') document.querySelector('.sidebar')?.classList.toggle('open');
  if (action === 'add') openEntityModal(target.dataset.type);
  if (action === 'edit') openEntityModal(target.dataset.type,target.dataset.id);
  if (action === 'delete') deleteEntity(target.dataset.type,target.dataset.id);
  if (action === 'close-modal') modalRoot.innerHTML='';
  if (action === 'mark-all-present') {
    const rows = db.students.map(s => ({ school_id:currentProfile.school_id, student_id:s.id, attendance_date:attendanceDate, status:'present' }));
    if (!rows.length) return toast('আগে শিক্ষার্থীর তথ্য যোগ করুন।', true);
    const { error } = await dbClient.from('attendance').upsert(rows, { onConflict:'school_id,student_id,attendance_date' });
    if (error) toast(backendError(error), true); else await refreshData('সব শিক্ষার্থীকে উপস্থিত চিহ্নিত করা হয়েছে।');
  }
  if (action === 'upload-docs') document.querySelector('#document-files')?.click();
  if (action === 'download-doc') downloadDocument(target.dataset.id);
  if (action === 'restore') document.querySelector('#restore-file')?.click();
});

app.addEventListener('submit', event => { handleSubmit(event); });
app.addEventListener('change', event => {
  if (event.target.matches('[data-attendance]')) handleAttendanceChange(event.target);
  if (event.target.id === 'attendance-date') { attendanceDate = event.target.value || localDateISO(); render(); }
  if (event.target.id === 'document-files') { storeDocuments(event.target.files); event.target.value=''; }
  if (event.target.id === 'restore-file') { restoreBackup(event.target.files[0]); event.target.value=''; }
});
app.addEventListener('input', event => {
  if (event.target.id !== 'global-search') return;
  const cursor = event.target.selectionStart;
  searchText = event.target.value;
  const content = document.querySelector('#page-content');
  if (content) content.innerHTML = renderCurrentPage();
  const input = document.querySelector('#global-search');
  if (input) { input.focus(); input.setSelectionRange(cursor,cursor); }
});

modalRoot.addEventListener('click', event => {
  if (event.target.dataset.close === 'true') modalRoot.innerHTML='';
});
modalRoot.addEventListener('click', event => {
  if (event.target.closest('[data-action="close-modal"]')) modalRoot.innerHTML='';
});
modalRoot.addEventListener('submit', event => { handleSubmit(event); });

initialize();
