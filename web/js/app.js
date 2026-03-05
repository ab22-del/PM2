/* ═══════════════════════════════════════════════════════════════
   PropManage - Core JavaScript
   ═══════════════════════════════════════════════════════════════ */

const API_BASE = window.location.origin;

// ─── Auth Helpers ────────────────────────────────────────────

function getToken() {
    return localStorage.getItem('pm_token');
}

function getUser() {
    const data = localStorage.getItem('pm_user');
    return data ? JSON.parse(data) : null;
}

function setAuth(data) {
    localStorage.setItem('pm_token', data.access_token);
    localStorage.setItem('pm_user', JSON.stringify({
        id: data.user_id,
        role: data.role,
        first_name: data.first_name,
        last_name: data.last_name,
        has_plan: data.has_plan,
    }));
}

function clearAuth() {
    localStorage.removeItem('pm_token');
    localStorage.removeItem('pm_user');
}

function isLoggedIn() {
    return !!getToken();
}

function requireAuth(role) {
    if (!isLoggedIn()) {
        window.location.href = role === 'tenant' ? '/web/tenant-login.html' : '/web/landlord-login.html';
        return false;
    }
    const user = getUser();
    if (user && user.role !== role) {
        if (user.role === 'owner') {
            window.location.href = '/web/owner-portal.html';
        } else if (user.role === 'tenant') {
            window.location.href = '/web/tenant-portal.html';
        } else {
            window.location.href = '/web/landlord-portal.html';
        }
        return false;
    }
    return true;
}

// ─── API Helpers ─────────────────────────────────────────────

async function apiCall(endpoint, options = {}) {
    const token = getToken();
    const isFormData = options.body instanceof FormData;
    const headers = {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...(token && { 'Authorization': `Bearer ${token}` }),
        ...options.headers,
    };

    let response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
        });
    } catch (e) {
        throw new Error('Unable to connect to server. Please try again later.');
    }

    if (response.status === 401) {
        clearAuth();
        const user = getUser();
        window.location.href = user?.role === 'tenant' ? '/web/tenant-login.html' : '/web/landlord-login.html';
        throw new Error('Session expired');
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
        throw new Error('Server error. Please try again later.');
    }

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.detail || 'Something went wrong');
    }
    return data;
}

// ─── Toast Notifications ─────────────────────────────────────

function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ─── Modal Helpers ───────────────────────────────────────────

function openModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.add('active');
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.classList.remove('active');
}

// ─── Scroll Animation Observer ───────────────────────────────

function initScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-visible');
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    document.querySelectorAll('.animate-on-scroll').forEach(el => {
        observer.observe(el);
    });
}

// ─── Format Helpers ──────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatCurrency(amount) {
    if (amount == null) return 'N/A';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function getStatusBadge(status) {
    const badges = {
        'open': 'badge-warning',
        'in_progress': 'badge-info',
        'scheduled': 'badge-primary',
        'completed': 'badge-success',
        'cancelled': 'badge-danger',
        'notified': 'badge-info',
        'resolved': 'badge-success',
        'invoiced': 'badge-warning',
    };
    return badges[status] || 'badge-info';
}

// ─── Init ────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
});
