/* ==========================================================================
   SMART FINANCE — MAIN APPLICATION CONTROLLER (SPA + CHARTS + EXPORT + PIN)
   ========================================================================== */

let cashflowChartInstance = null;
let reportChartInstance = null;

// Format Rupiah
function formatRupiah(angka) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0
    }).format(angka || 0);
}

// Generate UUID unik untuk sinkronisasi tanpa konflik
function generateUUID() {
    return 'sf_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/* ==========================================================================
   1. INISIALISASI APLIKASI & NAVIGASI SPA
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
    await SmartDB.init();

    // Set tanggal hari ini secara default pada form input
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('inc-date')) document.getElementById('inc-date').value = today;
    if (document.getElementById('exp-date')) document.getElementById('exp-date').value = today;

    // Cek Security PIN jika aktif
    checkSecurityPin();

    // Cek sesi pengguna (Guest atau Akun Permanen)
    const authMode = localStorage.getItem('sf_auth_mode');
    if (authMode === 'guest' || authMode === 'account') {
        navigateRoot('app');
        await refreshAllUI();
    } else {
        navigateRoot('landing');
    }

    // Monitor Status Online / Offline
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);

    // Daftarkan seluruh event listener formulir & tombol
    bindEvents();
});

// Navigasi Root View: 'landing' | 'auth' | 'app'
function navigateRoot(rootName, authTab = 'login') {
    document.querySelectorAll('.spa-root-view').forEach(el => el.style.display = 'none');
    const target = document.getElementById(`view-${rootName}`);
    if (target) target.style.display = rootName === 'auth' ? 'flex' : 'block';

    if (rootName === 'auth') {
        switchAuthTab(authTab);
    }
}

// Switch Tab Login / Register
function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('tab-login').classList.toggle('active', isLogin);
    document.getElementById('tab-register').classList.toggle('active', !isLogin);
    document.getElementById('form-login').style.display = isLogin ? 'block' : 'none';
    document.getElementById('form-register').style.display = !isLogin ? 'block' : 'none';

    document.getElementById('auth-title').textContent = isLogin ? 'Selamat Datang Kembali' : 'Buat Akun Permanen';
    document.getElementById('auth-subtitle').textContent = isLogin
        ? 'Masuk untuk mengakses dan menyinkronkan data keuangan Anda'
        : 'Nikmati backup cloud otomatis dan sinkronisasi lintas perangkat';

    if (!isLogin && localStorage.getItem('sf_auth_mode') === 'guest') {
        document.getElementById('guest-merge-notice').style.display = 'flex';
    }
}

// Masuk sebagai Mode Tamu (Penyimpanan Lokal)
async function startGuestMode() {
    localStorage.setItem('sf_auth_mode', 'guest');
    if (!localStorage.getItem('sf_guest_id')) {
        localStorage.setItem('sf_guest_id', 'guest_' + Date.now());
    }
    navigateRoot('app');
    navigatePage('dashboard');
    await refreshAllUI();
}

// Navigasi Antar Halaman di Dalam App Shell
const PAGE_META = {
    dashboard: ['Dashboard', 'Ringkasan kondisi keuangan Anda'],
    income: ['Pemasukan', 'Catat seluruh sumber pemasukan keuangan'],
    expense: ['Pengeluaran', 'Kontrol pengeluaran kebutuhan dan keinginan'],
    savings: ['Tabungan & Kalkulator', 'Rencanakan dan pantau progres target tabungan'],
    budget: ['Anggaran Bulanan', 'Batasi pengeluaran bulanan per kategori'],
    wallet: ['Multi-Dompet', 'Kelola saldo rekening bank, tunai, dan e-wallet'],
    history: ['Riwayat Transaksi', 'Telusuri seluruh catatan pemasukan dan pengeluaran'],
    report: ['Laporan & Ekspor', 'Analisis statistik dan unduh laporan PDF/Excel'],
    profile: ['Profil & Sinkronisasi', 'Status akun dan penggabungan data lokal'],
    settings: ['Pengaturan & PIN', 'Keamanan aplikasi dan cadangan memori lokal']
};

function navigatePage(pageKey) {
    document.querySelectorAll('.app-page').forEach(sec => sec.style.display = 'none');
    const activeSection = document.getElementById(`page-${pageKey}`);
    if (activeSection) activeSection.style.display = 'block';

    // Update status active di Sidebar & Mobile Bottom Nav
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === pageKey);
    });

    // Update Topbar Title
    if (PAGE_META[pageKey]) {
        document.getElementById('topbar-title').textContent = PAGE_META[pageKey][0];
        document.getElementById('topbar-subtitle').textContent = PAGE_META[pageKey][1];
    }

    // Render ulang chart jika membuka dashboard atau report
    if (pageKey === 'dashboard' || pageKey === 'report') {
        refreshAllUI();
    }
}

/* ==========================================================================
   2. STATUS KONEKSI ONLINE / OFFLINE & SYNC
   ========================================================================== */
function updateNetworkStatus() {
    const banner = document.getElementById('network-banner');
    const text = document.getElementById('network-status-text');
    if (!banner || !text) return;

    if (navigator.onLine) {
        banner.className = 'network-banner online';
        text.textContent = 'Online • Penyimpanan Lokal & Cloud Siap';
        triggerCloudSync();
    } else {
        banner.className = 'network-banner offline';
        text.textContent = 'Mode Offline • Transaksi Disimpan di Memori Lokal';
    }
}

async function triggerCloudSync() {
    if (!navigator.onLine || localStorage.getItem('sf_auth_mode') !== 'account') return;
    const queue = await SmartDB.getAll('sync_queue');
    if (queue.length === 0) return;

    try {
        const response = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queue })
        });
        if (response.ok) {
            const tx = SmartDB.db.transaction('sync_queue', 'readwrite');
            tx.objectStore('sync_queue').clear();
            document.getElementById('network-status-text').textContent = 'Online • Semua Data Tersinkronisasi';
        }
    } catch (err) {
        console.warn('Sinkronisasi tertunda (server belum aktif):', err);
    }
}

/* ==========================================================================
   3. RENDER SELURUH DATA DARI INDEXEDDB KE UI
   ========================================================================== */
async function refreshAllUI() {
    const wallets = await SmartDB.getAll('wallets');
    const transactions = await SmartDB.getAll('transactions');
    const savings = await SmartDB.getAll('savings');
    const budgets = await SmartDB.getAll('budgets');

    // Urutkan transaksi terbaru di atas
    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    // Update Info Akun (Guest vs Account)
    const isAccount = localStorage.getItem('sf_auth_mode') === 'account';
    const userName = localStorage.getItem('sf_user_name') || 'Pengguna Tamu';
    document.getElementById('account-mode-badge').textContent = isAccount ? 'Akun Tersinkronisasi' : 'Mode Tamu (Lokal)';
    document.getElementById('guest-upgrade-banner').style.display = isAccount ? 'none' : 'flex';
    document.getElementById('prof-name').textContent = userName;
    document.getElementById('prof-status').textContent = isAccount
        ? 'Akun Permanen (Cloud + Memori Lokal)'
        : 'Akun Tamu (100% Memori Lokal IndexedDB)';
    document.getElementById('prof-sync').textContent = isAccount ? 'Aktif Otomatis' : 'Belum Terhubung';
    document.getElementById('prof-merge-section').style.display = isAccount ? 'none' : 'block';

    // Hitung Ringkasan Saldo & Arus Kas Bulan Ini
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const totalBalance = wallets.reduce((sum, w) => sum + Number(w.balance), 0);
    const totalSavings = savings.reduce((sum, s) => sum + Number(s.current_amount), 0);

    let monthIn = 0;
    let monthOut = 0;
    let allIn = 0;
    let allOut = 0;

    transactions.forEach(tx => {
        const amt = Number(tx.amount);
        if (tx.type === 'income') {
            allIn += amt;
            if (tx.date.startsWith(currentMonth)) monthIn += amt;
        } else {
            allOut += amt;
            if (tx.date.startsWith(currentMonth)) monthOut += amt;
        }
    });

    // Update Kartu Dashboard & Laporan
    document.getElementById('dash-total-balance').textContent = formatRupiah(totalBalance);
    document.getElementById('dash-wallet-count').textContent = `${wallets.length} Dompet Aktif`;
    document.getElementById('dash-monthly-income').textContent = formatRupiah(monthIn);
    document.getElementById('dash-monthly-expense').textContent = formatRupiah(monthOut);
    document.getElementById('dash-total-savings').textContent = formatRupiah(totalSavings);

    document.getElementById('rep-total-in').textContent = formatRupiah(allIn);
    document.getElementById('rep-total-out').textContent = formatRupiah(allOut);
    document.getElementById('rep-net').textContent = formatRupiah(allIn - allOut);

    // Render Dropdown & Kartu Dompet
    renderWallets(wallets);

    // Render Tabel Transaksi (Dashboard, Income, Expense, Full History)
    renderTransactions(transactions, wallets);

    // Render Target Tabungan
    renderSavings(savings);

    // Render Anggaran Bulanan
    renderBudgets(budgets, transactions, currentMonth);

    // Render Grafik Chart.js
    renderCharts(monthIn, monthOut, transactions);
}

function renderWallets(wallets) {
    const dropdowns = document.querySelectorAll('.wallet-select-dropdown');
    dropdowns.forEach(select => {
        select.innerHTML = wallets.map(w =>
            `<option value="${w.id}">${w.name} (${formatRupiah(w.balance)})</option>`
        ).join('');
    });

    const walletGrid = document.getElementById('wallet-cards-list');
    if (walletGrid) {
        walletGrid.innerHTML = wallets.map(w => `
            <div class="wallet-card">
                <small style="opacity:0.8;">${w.type}</small>
                <h4 style="margin:4px 0 12px;">${w.name}</h4>
                <h3 style="color:#10B981;">${formatRupiah(w.balance)}</h3>
            </div>
        `).join('');
    }
}

function renderTransactions(transactions, wallets) {
    const walletMap = Object.fromEntries(wallets.map(w => [w.id, w.name]));

    // 1. Dashboard Recent (5 terbaru)
    const dashBody = document.getElementById('dash-recent-transactions');
    const recent = transactions.slice(0, 5);
    dashBody.innerHTML = recent.length ? recent.map(tx => `
        <tr>
            <td>${tx.date}</td>
            <td>${tx.note || tx.category}</td>
            <td>${walletMap[tx.wallet_id] || '-'}</td>
            <td>${tx.category}</td>
            <td class="text-right ${tx.type === 'income' ? 'text-green' : 'text-red'}">
                ${tx.type === 'income' ? '+' : '-'} ${formatRupiah(tx.amount)}
            </td>
        </tr>
    `).join('') : `<tr><td colspan="5" class="text-center empty-state-text">Belum ada transaksi tercatat.</td></tr>`;

    // 2. Tabel Income
    const incList = transactions.filter(t => t.type === 'income');
    document.getElementById('list-income-table').innerHTML = incList.length ? incList.map(tx => `
        <tr>
            <td>${tx.date}</td>
            <td>${tx.category}</td>
            <td>${walletMap[tx.wallet_id] || '-'}</td>
            <td class="text-right text-green">+ ${formatRupiah(tx.amount)}</td>
        </tr>
    `).join('') : `<tr><td colspan="4" class="text-center empty-state-text">Belum ada pemasukan.</td></tr>`;

    // 3. Tabel Expense
    const expList = transactions.filter(t => t.type === 'expense');
    document.getElementById('list-expense-table').innerHTML = expList.length ? expList.map(tx => `
        <tr>
            <td>${tx.date}</td>
            <td>${tx.category}</td>
            <td>${tx.expense_type || 'Kebutuhan'}</td>
            <td class="text-right text-red">- ${formatRupiah(tx.amount)}</td>
        </tr>
    `).join('') : `<tr><td colspan="4" class="text-center empty-state-text">Belum ada pengeluaran.</td></tr>`;

    // 4. Tabel Full History (dengan Filter)
    const filterType = document.getElementById('filter-history-type').value;
    const filterSearch = document.getElementById('filter-history-search').value.toLowerCase();

    const filtered = transactions.filter(tx => {
        const matchType = filterType === 'all' || tx.type === filterType;
        const matchText = (tx.note || '').toLowerCase().includes(filterSearch) ||
                          tx.category.toLowerCase().includes(filterSearch);
        return matchType && matchText;
    });

    document.getElementById('full-history-table').innerHTML = filtered.length ? filtered.map(tx => `
        <tr>
            <td>${tx.date}</td>
            <td><strong>${tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</strong></td>
            <td>${tx.category}</td>
            <td>${walletMap[tx.wallet_id] || '-'}</td>
            <td>${tx.note || '-'}</td>
            <td class="text-right ${tx.type === 'income' ? 'text-green' : 'text-red'}">
                ${tx.type === 'income' ? '+' : '-'} ${formatRupiah(tx.amount)}
            </td>
            <td>
                <button onclick="deleteTransaction('${tx.id}')" class="text-red" title="Hapus"><i class='bx bx-trash'></i></button>
            </td>
        </tr>
    `).join('') : `<tr><td colspan="7" class="text-center empty-state-text">Tidak ada transaksi ditemukan.</td></tr>`;
}

function renderSavings(savings) {
    const container = document.getElementById('savings-goals-grid');
    if (!savings.length) {
        container.innerHTML = `<p class="empty-state-text">Belum ada target tabungan. Silakan buat target baru di atas.</p>`;
        return;
    }

    container.innerHTML = savings.map(s => {
        const pct = Math.min(100, Math.round((s.current_amount / s.target_amount) * 100));
        return `
            <div class="saving-card">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h4>${s.title}</h4>
                    <span class="badge-guest">${pct}%</span>
                </div>
                <p style="font-size:0.82rem; color:#64748B; margin:4px 0 10px;">
                    Target: ${formatRupiah(s.target_amount)} • Tenggat: ${s.deadline}
                </p>
                <div class="progress-track" style="margin-bottom:10px;">
                    <div class="progress-fill" style="width:${pct}%"></div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <strong class="text-green">${formatRupiah(s.current_amount)}</strong>
                    <button onclick="topUpSaving('${s.id}')" class="btn btn-primary-green btn-sm">+ Setor Tabungan</button>
                </div>
            </div>
        `;
    }).join('');
}

function renderBudgets(budgets, transactions, currentMonth) {
    const dashBudget = document.getElementById('dash-budget-list');
    const detailBudget = document.getElementById('budget-detail-list');

    if (!budgets.length) {
        const emptyHtml = `<p class="empty-state-text">Belum ada anggaran bulanan diatur.</p>`;
        dashBudget.innerHTML = emptyHtml;
        detailBudget.innerHTML = emptyHtml;
        return;
    }

    const html = budgets.map(b => {
        const spent = transactions
            .filter(t => t.type === 'expense' && t.category === b.category && t.date.startsWith(currentMonth))
            .reduce((sum, t) => sum + Number(t.amount), 0);

        const pct = Math.min(100, Math.round((spent / b.limit) * 100));
        let barClass = '';
        if (pct >= 100) barClass = 'danger';
        else if (pct >= 80) barClass = 'warning';

        return `
            <div class="progress-item">
                <div class="progress-label">
                    <span>${b.category}</span>
                    <span>${formatRupiah(spent)} / ${formatRupiah(b.limit)} (${pct}%)</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${barClass}" style="width:${pct}%"></div>
                </div>
            </div>
        `;
    }).join('');

    dashBudget.innerHTML = html;
    detailBudget.innerHTML = html;
}

function renderCharts(monthIn, monthOut, transactions) {
    // 1. Dashboard Cashflow Chart
    const ctx1 = document.getElementById('cashflowChart');
    if (ctx1) {
        if (cashflowChartInstance) cashflowChartInstance.destroy();
        cashflowChartInstance = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: ['Pemasukan Bulan Ini', 'Pengeluaran Bulan Ini'],
                datasets: [{
                    label: 'Nominal (Rp)',
                    data: [monthIn, monthOut],
                    backgroundColor: ['#10B981', '#0A192F'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    // 2. Report Category Chart
    const ctx2 = document.getElementById('reportCategoryChart');
    if (ctx2) {
        const catTotals = {};
        transactions.filter(t => t.type === 'expense').forEach(t => {
            catTotals[t.category] = (catTotals[t.category] || 0) + Number(t.amount);
        });

        if (reportChartInstance) reportChartInstance.destroy();
        reportChartInstance = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catTotals).length ? Object.keys(catTotals) : ['Belum ada data'],
                datasets: [{
                    data: Object.values(catTotals).length ? Object.values(catTotals) : [1],
                    backgroundColor: ['#0A192F', '#10B981', '#1D3557', '#34D399', '#64748B', '#F59E0B']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }
}

/* ==========================================================================
   4. AKSI FORMULIR (TRANSAKSI, DOMPET, TABUNGAN, ANGGARAN, PIN, EKSPOR)
   ========================================================================== */
function bindEvents() {
    // Tambah Pemasukan
    document.getElementById('form-add-income').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = Number(document.getElementById('inc-amount').value);
        const walletId = document.getElementById('inc-wallet').value;

        await SmartDB.put('transactions', {
            id: generateUUID(),
            type: 'income',
            amount,
            category: document.getElementById('inc-category').value,
            wallet_id: walletId,
            date: document.getElementById('inc-date').value,
            note: document.getElementById('inc-note').value,
            updated_at: new Date().toISOString()
        });

        // Update saldo dompet
        const wallet = await SmartDB.getById('wallets', walletId);
        if (wallet) {
            wallet.balance = Number(wallet.balance) + amount;
            await SmartDB.put('wallets', wallet);
        }

        e.target.reset();
        document.getElementById('inc-date').value = new Date().toISOString().split('T')[0];
        await refreshAllUI();
        alert('Pemasukan berhasil disimpan!');
    });

    // Tambah Pengeluaran
    document.getElementById('form-add-expense').addEventListener('submit', async (e) => {
        e.preventDefault();
        const amount = Number(document.getElementById('exp-amount').value);
        const walletId = document.getElementById('exp-wallet').value;

        await SmartDB.put('transactions', {
            id: generateUUID(),
            type: 'expense',
            amount,
            expense_type: document.getElementById('exp-type').value,
            category: document.getElementById('exp-category').value,
            wallet_id: walletId,
            date: document.getElementById('exp-date').value,
            note: document.getElementById('exp-note').value,
            updated_at: new Date().toISOString()
        });

        // Potong saldo dompet
        const wallet = await SmartDB.getById('wallets', walletId);
        if (wallet) {
            wallet.balance = Number(wallet.balance) - amount;
            await SmartDB.put('wallets', wallet);
        }

        e.target.reset();
        document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
        await refreshAllUI();
        alert('Pengeluaran berhasil dicatat!');
    });

    // Tambah Target Tabungan
    document.getElementById('form-add-saving').addEventListener('submit', async (e) => {
        e.preventDefault();
        await SmartDB.put('savings', {
            id: generateUUID(),
            title: document.getElementById('sav-title').value,
            target_amount: Number(document.getElementById('sav-target').value),
            current_amount: Number(document.getElementById('sav-current').value || 0),
            deadline: document.getElementById('sav-deadline').value,
            reminder: document.getElementById('sav-reminder').value,
            updated_at: new Date().toISOString()
        });
        e.target.reset();
        await refreshAllUI();
        alert('Target tabungan berhasil dibuat!');
    });

    // Kalkulator Target Tabungan
    document.getElementById('btn-calc-saving').addEventListener('click', () => {
        const target = Number(document.getElementById('calc-target').value);
        const months = Number(document.getElementById('calc-months').value);
        if (!target || !months || months < 1) {
            alert('Masukkan target dana dan jangka waktu bulan yang valid.');
            return;
        }
        const monthly = Math.ceil(target / months);
        const weekly = Math.ceil(target / (months * 4));
        const daily = Math.ceil(target / (months * 30));

        document.getElementById('calc-res-monthly').textContent = formatRupiah(monthly);
        document.getElementById('calc-res-weekly').textContent = formatRupiah(weekly);
        document.getElementById('calc-res-daily').textContent = formatRupiah(daily);
        document.getElementById('calc-result-box').style.display = 'block';
    });

    // Simpan Anggaran Bulanan
    document.getElementById('form-add-budget').addEventListener('submit', async (e) => {
        e.preventDefault();
        await SmartDB.put('budgets', {
            category: document.getElementById('bud-category').value,
            limit: Number(document.getElementById('bud-limit').value),
            updated_at: new Date().toISOString()
        });
        e.target.reset();
        await refreshAllUI();
        alert('Anggaran bulanan berhasil disimpan!');
    });

    // Tambah Dompet Baru
    document.getElementById('form-add-wallet').addEventListener('submit', async (e) => {
        e.preventDefault();
        await SmartDB.put('wallets', {
            id: generateUUID(),
            name: document.getElementById('wal-name').value,
            type: document.getElementById('wal-type').value,
            balance: Number(document.getElementById('wal-balance').value),
            updated_at: new Date().toISOString()
        });
        e.target.reset();
        await refreshAllUI();
        alert('Dompet baru berhasil ditambahkan!');
    });

    // Filter Riwayat Transaksi
    document.getElementById('filter-history-type').addEventListener('change', refreshAllUI);
    document.getElementById('filter-history-search').addEventListener('input', refreshAllUI);

    // Export Excel (CSV compatible)
    document.getElementById('btn-export-excel').addEventListener('click', async () => {
        const transactions = await SmartDB.getAll('transactions');
        let csv = 'Tanggal,Tipe,Kategori,Nominal,Catatan\n';
        transactions.forEach(t => {
            csv += `"${t.date}","${t.type}","${t.category}",${t.amount},"${(t.note || '').replace(/"/g, '""')}"\n`;
        });
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Laporan_SMART_FINANCE_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
    });

    // Export PDF (Cetak Laporan)
    document.getElementById('btn-export-pdf').addEventListener('click', () => {
        window.print();
    });

    // Security PIN Setup & Disable
    document.getElementById('form-set-pin').addEventListener('submit', (e) => {
        e.preventDefault();
        const pin = document.getElementById('new-pin-input').value;
        if (/^\d{6}$/.test(pin)) {
            localStorage.setItem('sf_security_pin', btoa(pin));
            e.target.reset();
            alert('Security PIN 6 digit berhasil diaktifkan!');
        }
    });

    document.getElementById('btn-disable-pin').addEventListener('click', () => {
        localStorage.removeItem('sf_security_pin');
        alert('Security PIN telah dinonaktifkan.');
    });

    // Backup Lokal JSON
    document.getElementById('btn-backup-json').addEventListener('click', async () => {
        const fullData = await SmartDB.exportAllData();
        const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Backup_SmartFinance_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
    });

    // Register & Merge Guest Data ke Backend Flask
    document.getElementById('form-register').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        const localGuestData = await SmartDB.exportAllData();

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, guest_data: localGuestData })
            });
            const result = await res.json();
            if (res.ok) {
                localStorage.setItem('sf_auth_mode', 'account');
                localStorage.setItem('sf_user_name', name);
                navigateRoot('app');
                await refreshAllUI();
                alert('Akun berhasil dibuat dan data lokal telah digabungkan!');
            } else {
                alert(result.message || 'Gagal mendaftar.');
            }
        } catch {
            // Fallback mode lokal jika server Python belum dijalankan
            localStorage.setItem('sf_auth_mode', 'account');
            localStorage.setItem('sf_user_name', name);
            navigateRoot('app');
            await refreshAllUI();
            alert('Akun diaktifkan secara lokal (jalankan server Flask untuk sinkronisasi MySQL).');
        }
    });

    // Login Email
    document.getElementById('form-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const result = await res.json();
            if (res.ok) {
                localStorage.setItem('sf_auth_mode', 'account');
                localStorage.setItem('sf_user_name', result.name || email);
                navigateRoot('app');
                await refreshAllUI();
            } else {
                alert(result.message || 'Email atau kata sandi salah.');
            }
        } catch {
            alert('Server belum terhubung. Anda dapat menggunakan Mode Tamu terlebih dahulu.');
        }
    });

    // Logout
    document.getElementById('btn-logout').addEventListener('click', () => {
        localStorage.removeItem('sf_auth_mode');
        localStorage.removeItem('sf_user_name');
        navigateRoot('landing');
    });

    // Tombol Sync Manual
    document.getElementById('btn-sync-now').addEventListener('click', async () => {
        await triggerCloudSync();
        await refreshAllUI();
    });
}

// Helper: Setor Dana ke Target Tabungan
async function topUpSaving(savingId) {
    const nominalStr = prompt('Masukkan nominal setoran tabungan (Rp):');
    const nominal = Number(nominalStr);
    if (!nominal || nominal <= 0) return;

    const saving = await SmartDB.getById('savings', savingId);
    if (saving) {
        saving.current_amount = Number(saving.current_amount) + nominal;
        saving.updated_at = new Date().toISOString();
        await SmartDB.put('savings', saving);
        await refreshAllUI();
    }
}

// Helper: Hapus Transaksi & Kembalikan Saldo Dompet
async function deleteTransaction(txId) {
    if (!confirm('Hapus transaksi ini? Saldo dompet akan disesuaikan otomatis.')) return;
    const tx = await SmartDB.getById('transactions', txId);
    if (tx) {
        const wallet = await SmartDB.getById('wallets', tx.wallet_id);
        if (wallet) {
            wallet.balance = tx.type === 'income'
                ? Number(wallet.balance) - Number(tx.amount)
                : Number(wallet.balance) + Number(tx.amount);
            await SmartDB.put('wallets', wallet);
        }
        await SmartDB.delete('transactions', txId);
        await refreshAllUI();
    }
}

// Helper: Cek & Buka Kunci Security PIN
function checkSecurityPin() {
    const savedPin = localStorage.getItem('sf_security_pin');
    if (!savedPin) return;

    const overlay = document.getElementById('pin-lock-screen');
    overlay.style.display = 'flex';

    document.getElementById('btn-unlock-app').addEventListener('click', () => {
        const inputVal = document.getElementById('pin-unlock-input').value;
        if (btoa(inputVal) === savedPin) {
            overlay.style.display = 'none';
        } else {
            document.getElementById('pin-error-msg').style.display = 'block';
        }
    });
}
