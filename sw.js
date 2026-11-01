// Service worker: deixa o app abrir sem internet e, instalado no Android/Chrome, confere as contas sozinho
// algumas vezes por dia (periodic background sync) para avisar 2 dias antes, no dia e enquanto estiver atrasada.
import { avisarSePreciso } from './js/avisos.js';

const CACHE = 'financeiro-v2';
const ARQUIVOS = ['./', 'index.html', 'js/app.js', 'js/logica.js', 'js/avisos.js', 'manifest.webmanifest', 'icones/192.png', 'icones/512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// rede primeiro (pega as atualizações do site), cache se estiver sem internet
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(CACHE).then(c => c.put(req, copia)); }
    return r;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});

// sem permissão, showNotification falha e o dia não fica marcado como avisado
const avisar = () => avisarSePreciso((t, o) => self.registration.showNotification(t, o)).catch(() => null);
self.addEventListener('periodicsync', e => { if (e.tag === 'contas') e.waitUntil(avisar()); });
self.addEventListener('message', e => { if (e.data === 'avisar') e.waitUntil(avisar()); });

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const aberto = cs.find(c => new URL(c.url).pathname.startsWith(new URL('./', location).pathname));
    return aberto ? aberto.focus() : self.clients.openWindow('./');
  }));
});
