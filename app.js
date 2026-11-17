/* ==========================================================================
   5. PWA INSTALL PROMPT & SHORTCUT HANDLER
   ========================================================================== */
let deferredPrompt;
const installBtn = document.getElementById('btn-install-pwa');

window.addEventListener('beforeinstallprompt', (e) => {
    // Cegah banner bawaan browser muncul terlalu cepat
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) {
        installBtn.style.display = 'inline-flex';
    }
});

if (installBtn) {
    installBtn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            installBtn.style.display = 'none';
        }
        deferredPrompt = null;
    });
}

// Menangani PWA App Shortcuts (misal: tahan ikon aplikasi di HP -> Catat Pengeluaran)
window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const shortcut = params.get('shortcut');
    if (shortcut && (localStorage.getItem('sf_auth_mode') === 'guest' || localStorage.getItem('sf_auth_mode') === 'account')) {
        navigatePage(shortcut);
    }
});
