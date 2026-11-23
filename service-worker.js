/* Cache only the public application shell. Never cache authenticated pages, API responses or school records. */
const CACHE = 'school-public-shell-v1';
const SHELL = ['./','./index.html','./styles.css','./app.js','./supabase-config.js','./manifest.webmanifest','./app-icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/school/'))return;
 if(url.pathname.includes('/data/')||url.pathname.includes('/api/')||event.request.mode==='navigate')return;
 if(!SHELL.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response;}).catch(()=>caches.match(event.request)));
});