/* ==========================================================================
   SMART FINANCE — SERVICE WORKER (OFFLINE-FIRST ENGINE)
   ========================================================================== */

const CACHE_NAME = 'smart-finance-v1.0.0';

// Daftar aset inti yang wajib disimpan di memori lokal saat pertama kali dibuka
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/db.js',
    '/static/js/app.js',
    '/static/manifest.json',
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap',
    'https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

// 1. INSTALL EVENT: Simpan seluruh aset utama ke Cache Storage
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Menyimpan aset SMART FINANCE ke cache lokal...');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// 2. ACTIVATE EVENT: Bersihkan versi cache lama jika ada pembaruan aplikasi
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('[SW] Menghapus cache versi lama:', cache);
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. FETCH EVENT: Strategi Offline-First
self.addEventListener('fetch', (event) => {
    const requestUrl = new URL(event.request.url);

    // Abaikan request non-GET (POST/PUT/DELETE ditangani oleh IndexedDB sync_queue)
    if (event.request.method !== 'GET') {
        return;
    }

    // Strategi Network-First untuk panggilan API Backend (/api/* atau /auth/*)
    if (requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/auth/')) {
        event.respondWith(
            fetch(event.request)
                .catch(() => {
                    return new Response(
                        JSON.stringify({ offline: true, message: 'Sedang offline, data disimpan secara lokal.' }),
                        { headers: { 'Content-Type': 'application/json' } }
                    );
                })
        );
        return;
    }

    // Strategi Cache-First (dengan fallback Network & Dynamic Caching) untuk UI & Aset
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }

            return fetch(event.request)
                .then((networkResponse) => {
                    // Simpan aset baru yang valid (misalnya file font woff2 dari CDN) ke cache
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    // Jika offline dan user membuka rute halaman, kembalikan root SPA (index.html)
                    if (event.request.mode === 'navigate') {
                        return caches.match('/');
                    }
                });
        })
    );
});
