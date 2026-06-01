/**
 * AquaSense Pro — Smart Water Tank Logic
 * Real-time via SSE + fallback polling
 * + Notification System + Auth + Filter
 */

// =============================================
// CONFIGURATION
// =============================================
const TANK_CAPACITY = 1.7;
const API_BASE      = "http://127.0.0.1:5000";
const CORRECT_PW    = "kelompokdelapan";

// =============================================
// DOM Elements
// =============================================
const percentText     = document.getElementById('percent-val');
const literText       = document.getElementById('liter-val');
const remainText      = document.getElementById('remain-val');
const statusText      = document.getElementById('status-text');
const waterFill       = document.getElementById('water-level-fill');
const progressBar     = document.getElementById('progress-bar');
const historyLog      = document.getElementById('history-log');
const clockEl         = document.getElementById('real-time-clock');
const connectionBadge = document.getElementById('connection-badge');
const toastStack      = document.getElementById('toast-stack');
const notifBell       = document.getElementById('notif-bell');
const notifDropdown   = document.getElementById('notif-dropdown');
const notifList       = document.getElementById('notif-list');
const notifCount      = document.getElementById('notif-count');
const clearNotifsBtn  = document.getElementById('clear-notifs');
const tankLiterLabel  = document.getElementById('tank-liter-label');

// Login
const loginScreen   = document.getElementById('login-screen');
const dashboard     = document.getElementById('dashboard');
const passwordInput = document.getElementById('password-input');
const loginBtn      = document.getElementById('login-btn');
const exitBtn       = document.getElementById('exit-btn');
const loginError    = document.getElementById('login-error');
const togglePw      = document.getElementById('toggle-pw');
const logoutBtn     = document.getElementById('logout-btn');

// Delete modal
const deleteModal  = document.getElementById('delete-modal');
const modalCancel  = document.getElementById('modal-cancel');
const modalConfirm = document.getElementById('modal-confirm');

// History filter
const filterBtns = document.querySelectorAll('.filter-btn');

// =============================================
// GLOBAL STATE
// =============================================
let lastStatus      = '';
let notifHistory    = [];
let unreadCount     = 0;
let lastEntryId     = null;
let sseSource       = null;
let reconnectTimer  = null;
let activeFilter    = 'semua';   // semua | cukup | sedang | kritis
let pendingDeleteId = null;
let allHistoryRows  = [];

// =============================================
// AUTH
// =============================================
function tryLogin() {
    const val = passwordInput.value;
    if (val === CORRECT_PW) {
        loginError.classList.add('hidden');
        loginScreen.classList.add('fade-out');
        setTimeout(() => {
            loginScreen.classList.add('hidden');
            dashboard.classList.remove('hidden');
            dashboard.classList.add('fade-in');
            initDashboard();
        }, 400);
    } else {
        loginError.classList.remove('hidden');
        passwordInput.value = '';
        passwordInput.focus();
        passwordInput.classList.add('shake');
        setTimeout(() => passwordInput.classList.remove('shake'), 500);
    }
}

loginBtn.addEventListener('click', tryLogin);
passwordInput.addEventListener('keydown', e => { if (e.key === 'Enter') tryLogin(); });

exitBtn.addEventListener('click', () => {
    window.close();
    // fallback jika window.close() diblokir browser
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#888">Anda dapat menutup tab ini.</div>';
});

togglePw.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    document.getElementById('eye-icon').style.opacity = isText ? '1' : '0.4';
});

logoutBtn.addEventListener('click', () => {
    if (sseSource) { sseSource.close(); sseSource = null; }
    dashboard.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    loginScreen.classList.remove('fade-out');
    passwordInput.value = '';
    loginError.classList.add('hidden');
});

// =============================================
// INIT DASHBOARD
// =============================================
function initDashboard() {
    renderNotifDropdown();
    loadInitialHistory();
    connectSSE();
}

// =============================================
// CONNECTION STATUS
// =============================================
function setConnectionStatus(connected) {
    if (connected) {
        connectionBadge.textContent = 'ESP32: TERHUBUNG';
        connectionBadge.className   = 'badge online';
    } else {
        connectionBadge.textContent = 'ESP32: TERPUTUS';
        connectionBadge.className   = 'badge offline';
    }
}

// =============================================
// SSE
// =============================================
function connectSSE() {
    if (sseSource) { sseSource.close(); sseSource = null; }
    sseSource = new EventSource(`${API_BASE}/api/stream`);

    sseSource.addEventListener('water_data', (e) => {
        const data = JSON.parse(e.data);
        setConnectionStatus(true);
        updateUI(data.persentase);
        if (data.id !== lastEntryId) {
            lastEntryId = data.id;
            allHistoryRows.unshift(data);
            rebuildHistoryTable();
        }
    });

    sseSource.onopen = () => {
        setConnectionStatus(true);
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    };

    sseSource.onerror = () => {
        setConnectionStatus(false);
        sseSource.close(); sseSource = null;
        reconnectTimer = setTimeout(connectSSE, 5000);
    };
}

// =============================================
// UI UPDATE
// =============================================
function updateUI(percentage) {
    const liters    = (percentage / 100 * TANK_CAPACITY).toFixed(2);
    const remaining = (TANK_CAPACITY - liters).toFixed(2);

    percentText.innerText = Math.round(percentage);
    literText.innerText   = liters;
    remainText.innerText  = remaining;

    waterFill.style.height = `${percentage}%`;
    progressBar.style.strokeDashoffset = 283 - (percentage / 100 * 283);

    if (tankLiterLabel) tankLiterLabel.textContent = `${liters} L`;

    updateStatus(percentage);
}

function updateStatus(val) {
    let color, statusMsg, newStatus;

    if (val < 30) {
        color     = 'var(--critical)';
        statusMsg = 'KRITIS — ISI TANGKI!';
        newStatus = 'kritis';
    } else if (val <= 70) {
        color     = 'var(--medium)';
        statusMsg = 'LEVEL SEDANG';
        newStatus = 'sedang';
    } else {
        color     = 'var(--full)';
        statusMsg = 'TANGKI PENUH';
        newStatus = 'cukup';
    }

    statusText.innerText     = statusMsg;
    statusText.style.color   = color;
    progressBar.style.stroke = color;

    if (newStatus !== lastStatus) {
        triggerStatusNotification(newStatus, val);
        lastStatus = newStatus;
    }
}

// =============================================
// HISTORY FILTER — by status
// =============================================
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.status;
        rebuildHistoryTable();
    });
});

function getFilteredRows() {
    if (activeFilter === 'semua') return allHistoryRows;
    return allHistoryRows.filter(r => getStatusKey(r) === activeFilter);
}

function getStatusKey(row) {
    const pct = row.persentase;
    if (pct < 30)       return 'kritis';
    if (pct <= 70)      return 'sedang';
    return 'cukup';
}

function rebuildHistoryTable() {
    historyLog.innerHTML = '';
    getFilteredRows().slice(0, 10).forEach(r => appendHistoryRow(r));
}

// =============================================
// HISTORY TABLE
// =============================================
function appendHistoryRow(row, animate = false) {
    const pct = row.persentase;
    let statusColor = '--full';
    if (pct < 30)       statusColor = '--critical';
    else if (pct <= 70) statusColor = '--medium';

    const waktu   = new Date(row.waktu);
    const timeStr = waktu.toLocaleTimeString('id-ID', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    const tr = document.createElement('tr');
    if (animate) tr.style.animation = 'row-flash 0.6s ease';
    tr.dataset.id = row.id;
    tr.innerHTML = `
        <td>${timeStr}</td>
        <td>${pct}%</td>
        <td>${parseFloat(row.volume_liter).toFixed(2)} L</td>
        <td style="color:var(${statusColor})">${translateStatus(row.status)}</td>
        <td>
            <button class="delete-row-btn" title="Hapus data ini" data-id="${row.id}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;transform:none">
                    <polyline points="3,6 21,6"/>
                    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>
                    <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <line x1="10" y1="11" x2="10" y2="17"/>
                    <line x1="14" y1="11" x2="14" y2="17"/>
                </svg>
            </button>
        </td>
    `;

    tr.querySelector('.delete-row-btn').addEventListener('click', (e) => {
        pendingDeleteId = e.currentTarget.dataset.id;
        deleteModal.classList.remove('hidden');
    });

    historyLog.appendChild(tr);
}

function translateStatus(s) {
    const map = { kritis: 'KRITIS', sedang: 'SEDANG', cukup: 'PENUH', full: 'PENUH' };
    return map[s?.toLowerCase()] || s?.toUpperCase() || '-';
}

async function loadInitialHistory() {
    try {
        const res  = await fetch(`${API_BASE}/api/history`);
        const rows = await res.json();
        if (!Array.isArray(rows)) return;
        allHistoryRows = rows;
        rebuildHistoryTable();
        if (rows.length > 0) lastEntryId = rows[0].id;
    } catch (e) {
        console.warn('Gagal load history:', e.message);
    }
}

// =============================================
// DELETE MODAL
// =============================================
modalCancel.addEventListener('click', () => {
    deleteModal.classList.add('hidden');
    pendingDeleteId = null;
});

modalConfirm.addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    deleteModal.classList.add('hidden');

    const tr = historyLog.querySelector(`tr[data-id="${pendingDeleteId}"]`);
    if (tr) { tr.style.animation = 'row-delete 0.3s ease forwards'; setTimeout(() => tr.remove(), 300); }

    allHistoryRows = allHistoryRows.filter(r => String(r.id) !== String(pendingDeleteId));

    try {
        await fetch(`${API_BASE}/api/history/${pendingDeleteId}`, { method: 'DELETE' });
    } catch(e) { /* server mungkin belum ada endpoint ini */ }

    pendingDeleteId = null;
});

deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) { deleteModal.classList.add('hidden'); pendingDeleteId = null; }
});

// =============================================
// NOTIFICATION SYSTEM
// =============================================
function triggerStatusNotification(status, val) {
    const lvl = Math.round(val);
    const vol = (val / 100 * TANK_CAPACITY).toFixed(2);
    const map = {
        kritis: { type: 'critical', title: '🚨 KRITIS — TANGKI HAMPIR KOSONG',
                  msg: `Level air ${lvl}% (${vol} L). Segera isi tangki!`, dur: 0 },
        sedang: { type: 'warning',  title: '⚠️ Level Sedang',
                  msg: `Air di ${lvl}% (${vol} L). Pantau terus.`, dur: 5000 },
        cukup:  { type: 'success',  title: '✅ Tangki Penuh',
                  msg: `Level air ${lvl}% — kondisi baik.`, dur: 4000 }
    };
    const n = map[status];
    if (n) pushNotification(n.type, n.title, n.msg, n.dur);
}

function pushNotification(type, title, message, duration = 5000) {
    showToast(type, title, message, duration);
    ringBell();
    const entry = { type, title, message, time: new Date().toLocaleTimeString(), id: Date.now() };
    notifHistory.unshift(entry);
    unreadCount++;
    renderNotifDropdown();
    updateBadge();
}

function showToast(type, title, message, duration) {
    const icons = { critical: '🚨', warning: '⚠️', success: '✅' };
    const toast = document.createElement('div');
    toast.className = `toast-item ${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type]}</span>
        <div class="toast-body">
            <div class="toast-title">${title}</div>
            <div class="toast-msg">${message}</div>
        </div>
        <button class="toast-close" title="Tutup">✕</button>
        ${duration > 0 ? `<div class="toast-progress" style="animation-duration:${duration}ms"></div>` : ''}
    `;
    toastStack.appendChild(toast);
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('show')));
    toast.querySelector('.toast-close').addEventListener('click', () => dismissToast(toast));
    if (duration > 0) setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(t) {
    t.classList.add('dismiss');
    t.classList.remove('show');
    setTimeout(() => t.remove(), 500);
}

function ringBell() {
    notifBell.classList.remove('ringing');
    void notifBell.offsetWidth;
    notifBell.classList.add('ringing', 'has-notif');
    setTimeout(() => notifBell.classList.remove('ringing'), 700);
}

function updateBadge() {
    if (unreadCount > 0) {
        notifCount.textContent = unreadCount > 9 ? '9+' : unreadCount;
        notifCount.classList.add('visible');
    } else {
        notifCount.classList.remove('visible');
    }
}

function renderNotifDropdown() {
    if (notifHistory.length === 0) {
        notifList.innerHTML = '<li class="notif-empty">Belum ada notifikasi</li>';
        return;
    }
    const icons = { critical: '🚨', warning: '⚠️', success: '✅' };
    notifList.innerHTML = notifHistory.slice(0, 20).map(n => `
        <li class="notif-item ${n.type}" data-id="${n.id}">
            <span class="notif-item-icon">${icons[n.type]}</span>
            <div class="notif-item-body">
                <div class="notif-item-title">${n.title}</div>
                <div class="notif-item-msg">${n.message}</div>
                <div class="notif-item-time">${n.time}</div>
            </div>
        </li>
    `).join('');
}

notifBell.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('hidden');
    if (!notifDropdown.classList.contains('hidden')) { unreadCount = 0; updateBadge(); }
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-bell-wrapper')) notifDropdown.classList.add('hidden');
});

clearNotifsBtn.addEventListener('click', () => {
    notifHistory = []; unreadCount = 0;
    updateBadge();
    notifBell.classList.remove('has-notif');
    renderNotifDropdown();
    notifDropdown.classList.add('hidden');
});

// =============================================
// CLOCK
// =============================================
setInterval(() => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2,'0');
    const m = String(now.getMinutes()).padStart(2,'0');
    clockEl.innerText = `${h}:${m}`;
}, 1000);