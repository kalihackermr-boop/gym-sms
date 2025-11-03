import {
  formatCurrency,
  formatDate,
  monthsToLabel,
  statusMeta,
  matchesQuery,
  computeDashboardMetrics,
  downloadBlob,
  generateTimelineEntry,
  generateMemberId,
  hasExpired,
  relativeDate,
  toISODate,
} from './utils.js';
import { loadSettings, saveSettings } from './storage.js';
import { fetchMembers, saveMembers, testConnection } from './githubService.js';

const AUTH_KEY = 'gymhq.auth.v1';
const AUTH_CREDENTIALS = {
  username: 'owner',
  password: 'StrongPass!23',
};
let appInitialized = false;

const dom = {};

const state = {
  settings: loadSettings(),
  members: [],
  filters: {
    search: '',
    status: 'all',
    plan: 'all',
    joinRange: 'any',
    expiryRange: 'any',
    showInactive: false,
  },
  selectedMemberId: null,
  mode: 'idle',
  pendingSync: false,
  auth: {
    loggedIn: sessionStorage.getItem(AUTH_KEY) === 'true',
  },
};

const modalState = {
  open: false,
  editMemberId: null,
};

const FILTER_RANGE_MAP = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

function qs(selector) {
  return document.querySelector(selector);
}

function qsa(selector) {
  return [...document.querySelectorAll(selector)];
}

function captureDom() {
  Object.assign(dom, {
    authScreen: qs('[data-auth-screen]'),
    loginForm: qs('[data-login-form]'),
    statusBanner: qs('[data-status-banner]'),
    membersTable: qs('[data-members-table]'),
    membersBody: qs('[data-members-body]'),
    emptyState: qs('[data-empty-state]'),
    memberModal: qs('[data-member-modal]'),
    modalBackdrop: qs('[data-modal-backdrop]'),
    memberForm: qs('[data-member-form]'),
    memberModalTitle: qs('[data-member-modal-title]'),
    settingsDrawer: qs('[data-settings-drawer]'),
    settingsForm: qs('[data-settings-form]'),
    toastStack: qs('[data-toast-stack]'),
    detailPanel: qs('[data-detail-panel]'),
    detailContent: qs('[data-detail-content]'),
    detailName: qs('[data-detail-name]'),
    dashboardTotal: qs('[data-stat-total] .metric'),
    dashboardActive: qs('[data-stat-active] .metric'),
    dashboardPending: qs('[data-stat-pending] .metric'),
    dashboardExpired: qs('[data-stat-expired] .metric'),
    dashboardRevenue: qs('[data-stat-revenue] .metric'),
  });
}

function bindAuthEvents() {
  if (!dom.loginForm) return;
  dom.loginForm.addEventListener('submit', onLoginSubmit);
  dom.loginForm.username.value = AUTH_CREDENTIALS.username;
  dom.loginForm.password.value = '';
}

function bindGlobalEvents() {
  qs('[data-open-settings]').addEventListener('click', openSettings);
  qs('[data-close-settings]').addEventListener('click', closeSettings);
  qs('[data-open-member-modal]').addEventListener('click', () => openMemberModal());
  dom.modalBackdrop.addEventListener('click', closeMemberModal);
  qs('[data-close-member-modal]').addEventListener('click', closeMemberModal);
  qs('[data-close-detail]').addEventListener('click', () => clearSelection());
  qs('[data-test-connection]').addEventListener('click', onTestConnection);
  qs('[data-reset-filters]').addEventListener('click', resetFilters);
  qsa('[data-open-member-modal]').forEach((btn) =>
    btn.addEventListener('click', () => openMemberModal()),
  );
  qsa('[data-view]').forEach((chip) =>
    chip.addEventListener('click', () => quickView(chip.dataset.view)),
  );
  qs('[data-export-roster]').addEventListener('click', exportRoster);

  dom.memberForm.addEventListener('submit', onMemberFormSubmit);
  dom.settingsForm.addEventListener('submit', onSaveSettings);

  qs('[data-filter-search]').addEventListener('input', (event) =>
    updateFilter('search', event.target.value),
  );
  qs('[data-filter-status]').addEventListener('change', (event) =>
    updateFilter('status', event.target.value),
  );
  qs('[data-filter-plan]').addEventListener('change', (event) =>
    updateFilter('plan', event.target.value),
  );
  qs('[data-filter-join-range]').addEventListener('change', (event) =>
    updateFilter('joinRange', event.target.value),
  );
  qs('[data-filter-expiry-range]').addEventListener('change', (event) =>
    updateFilter('expiryRange', event.target.value),
  );
  qs('[data-filter-show-inactive]').addEventListener('change', (event) =>
    updateFilter('showInactive', event.target.checked),
  );

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (modalState.open) {
        closeMemberModal();
      } else if (!dom.settingsDrawer.hidden) {
        closeSettings();
      }
    }
  });
}

function onLoginSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const username = form.username.value.trim();
  const password = form.password.value;
  if (
    username === AUTH_CREDENTIALS.username &&
    password === AUTH_CREDENTIALS.password
  ) {
    unlockApp();
  } else {
    pushToast('Invalid credentials. Try owner / StrongPass!23.', 'danger');
    form.password.value = '';
    form.password.focus();
  }
}

function lockApp() {
  document.body.classList.add('auth-locked');
  if (dom.loginForm) {
    dom.loginForm.username.value = AUTH_CREDENTIALS.username;
    dom.loginForm.password.value = '';
    requestAnimationFrame(() => {
      dom.loginForm.username.focus();
    });
  }
  sessionStorage.removeItem(AUTH_KEY);
  state.auth.loggedIn = false;
}

async function unlockApp() {
  if (state.auth.loggedIn) {
    document.body.classList.remove('auth-locked');
    return;
  }
  state.auth.loggedIn = true;
  sessionStorage.setItem(AUTH_KEY, 'true');
  document.body.classList.remove('auth-locked');
  pushToast('Welcome back! Dashboard unlocked.', 'success');
  await initializeApp();
}

function applyAuthState() {
  if (state.auth.loggedIn) {
    document.body.classList.remove('auth-locked');
  } else {
    lockApp();
  }
}

function initForms() {
  const { settings } = state;
  dom.settingsForm.githubToken.value = settings.token ?? '';
  dom.settingsForm.repoOwner.value = settings.repoOwner ?? '';
  dom.settingsForm.repoName.value = settings.repoName ?? '';
  dom.settingsForm.dataPath.value = settings.dataPath ?? 'data/members.json';
  dom.settingsForm.defaultFee.value = settings.defaultFee ?? 1200;
  dom.settingsForm.defaultPlan.value = settings.defaultPlan ?? 12;
  dom.settingsForm.autoId.checked = Boolean(settings.autoId);
}

function initFilters() {
  qs('[data-filter-search]').value = state.filters.search;
  qs('[data-filter-status]').value = state.filters.status;
  qs('[data-filter-plan]').value = state.filters.plan;
  qs('[data-filter-join-range]').value = state.filters.joinRange;
  qs('[data-filter-expiry-range]').value = state.filters.expiryRange;
  qs('[data-filter-show-inactive]').checked = state.filters.showInactive;
}

async function initializeApp() {
  if (appInitialized) return;
  appInitialized = true;
  bindGlobalEvents();
  initForms();
  initFilters();
  renderMembers();
  renderDashboard();
  updateStatusBanner('Connect to GitHub in Settings to sync your roster.', 'info');
  if (state.settings.repoOwner && state.settings.repoName) {
    await refreshFromGitHub();
  }
}

async function bootstrap() {
  captureDom();
  bindAuthEvents();
  applyAuthState();
  if (state.auth.loggedIn) {
    await initializeApp();
  }
}

async function refreshFromGitHub() {
  try {
    updateStatusBanner('Syncing roster from GitHub…', 'info');
    const { members } = await fetchMembers(state.settings);
    state.members = normalizeMembers(members);
    state.pendingSync = false;
    updateStatusBanner('Roster synced with GitHub.', 'success', 3500);
    renderMembers();
    renderDashboard();
  } catch (error) {
    console.error(error);
    if (state.members.length === 0) {
      updateStatusBanner(error.message, 'danger');
    } else {
      updateStatusBanner(`Offline mode: ${error.message}`, 'warning');
    }
    pushToast(error.message, 'danger');
  }
}

function normalizeMembers(members) {
  return members.map((member) => ({
    id: member.id ?? generateMemberId('GYM', Math.random()),
    name: member.name ?? '',
    phone: member.phone ?? '',
    place: member.place ?? '',
    planMonths: Number(member.planMonths ?? member.plan ?? 1),
    fee: Number(member.fee ?? member.amount ?? 0),
    joinDate: toISODate(member.joinDate ?? member.startedAt ?? ''),
    expiryDate: toISODate(member.expiryDate ?? member.endsAt ?? ''),
    status: member.status ?? (hasExpired(member.expiryDate) ? 'expired' : 'active'),
    notes: member.notes ?? '',
    avatarUrl: member.avatarUrl ?? member.photoUrl ?? '',
    payment: member.payment ?? {
      amount: Number(member.fee ?? 0),
      paidAt: member.joinDate ?? null,
      mode: member.payment?.mode ?? 'cash',
    },
    history: Array.isArray(member.history) ? member.history : [],
    createdAt: member.createdAt ?? member.joinDate ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }));
}

function renderMembers() {
  const filtered = filterMembers();
  dom.membersBody.innerHTML = '';
  if (filtered.length === 0) {
    dom.emptyState.hidden = false;
    dom.membersTable.classList.add('empty');
  } else {
    dom.emptyState.hidden = true;
    dom.membersTable.classList.remove('empty');
    const template = document.getElementById('member-row-template');
    for (const member of filtered) {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.memberId = member.id;
      node.querySelector('[data-name]').textContent = member.name;
      node.querySelector('[data-phone]').textContent = member.phone || 'No phone';
      node.querySelector('[data-plan]').textContent = monthsToLabel(member.planMonths);
      node.querySelector('[data-joined]').textContent = formatDate(member.joinDate);
      node.querySelector('[data-expiry]').textContent = formatDate(member.expiryDate);
      node.querySelector('[data-amount]').textContent = formatCurrency(member.fee);
      const pill = node.querySelector('[data-status-pill]');
      pill.dataset.status = member.status;
      pill.dataset.statusText = member.status;
      pill.textContent = statusMeta(member.status).label;
      const avatar = node.querySelector('[data-avatar]');
      avatar.src = member.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=312e81&color=f8fafc`;
      avatar.alt = `${member.name} avatar`;
      node.querySelector('[data-view-member]').addEventListener('click', () => selectMember(member.id));
      node.querySelector('[data-mark-paid]').addEventListener('click', () => markAsPaid(member.id));
      node.querySelector('[data-open-menu]').addEventListener('click', (event) =>
        openRowMenu(event, member.id),
      );
      dom.membersBody.appendChild(node);
    }
  }
  if (state.selectedMemberId) {
    const nextSelected = filtered.find((m) => m.id === state.selectedMemberId);
    if (!nextSelected) {
      clearSelection();
    }
  }
}

function filterMembers() {
  const filters = state.filters;
  return state.members.filter((member) => {
    if (!filters.showInactive && member.status === 'archived') return false;
    if (filters.status !== 'all' && member.status !== filters.status) return false;
    if (filters.plan !== 'all' && String(member.planMonths) !== filters.plan) return false;
    if (filters.search && !matchesQuery(member, filters.search)) return false;
    if (!passesJoinRange(member, filters.joinRange)) return false;
    if (!passesExpiryRange(member, filters.expiryRange)) return false;
    return true;
  });
}

function passesJoinRange(member, option) {
  if (option === 'any') return true;
  const join = new Date(member.joinDate);
  if (Number.isNaN(join)) return true;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (option === 'year') {
    return join.getFullYear() === now.getFullYear();
  }
  const days = FILTER_RANGE_MAP[option];
  if (!days) return true;
  const diff = (now - join) / (1000 * 60 * 60 * 24);
  return diff <= days;
}

function passesExpiryRange(member, option) {
  if (option === 'any') return true;
  const expiry = new Date(member.expiryDate);
  if (Number.isNaN(expiry)) return false;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (option === 'overdue') return expiry < now;
  const days = FILTER_RANGE_MAP[option];
  if (!days) return true;
  const limit = new Date(now);
  limit.setDate(limit.getDate() + days);
  return expiry >= now && expiry <= limit;
}

function renderDashboard() {
  const metrics = computeDashboardMetrics(state.members);
  dom.dashboardTotal.textContent = metrics.total;
  dom.dashboardActive.textContent = metrics.active;
  dom.dashboardPending.textContent = metrics.pending;
  dom.dashboardExpired.textContent = metrics.expired;
  dom.dashboardRevenue.textContent = formatCurrency(metrics.revenue);
}

function selectMember(memberId) {
  state.selectedMemberId = memberId;
  renderDetail();
}

function clearSelection() {
  state.selectedMemberId = null;
  dom.detailName.textContent = 'Select a member';
  dom.detailContent.innerHTML = `
    <div class="placeholder">
      <p>Pick a member to review history, update payments, or send their digital ID instantly.</p>
    </div>
  `;
}

function renderDetail() {
  const member = state.members.find((m) => m.id === state.selectedMemberId);
  if (!member) {
    clearSelection();
    return;
  }
  dom.detailName.textContent = member.name;
  const template = document.getElementById('member-detail-template');
  const node = template.content.firstElementChild.cloneNode(true);
  node.dataset.memberId = member.id;
  node.querySelector('[data-name]').textContent = member.name;
  node.querySelector('[data-status]').textContent = `${statusMeta(member.status).label} • ${relativeDate(member.expiryDate) || 'No expiry'}`;
  node.querySelector('[data-phone]').textContent = member.phone || '—';
  node.querySelector('[data-place]').textContent = member.place || '—';
  node.querySelector('[data-plan]').textContent = monthsToLabel(member.planMonths);
  node.querySelector('[data-fee]').textContent = formatCurrency(member.fee);
  node.querySelector('[data-joined]').textContent = formatDate(member.joinDate);
  node.querySelector('[data-expiry]').textContent = formatDate(member.expiryDate);
  node.querySelector('[data-amount]').textContent = formatCurrency(member.payment?.amount ?? member.fee);
  node.querySelector('[data-payment-status]').textContent = member.status === 'pending' ? 'Payment due' : 'Settled';
  node.querySelector('[data-notes]').textContent = member.notes?.trim() || 'No notes yet.';
  const avatar = node.querySelector('[data-avatar]');
  avatar.src = member.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(member.name)}&background=312e81&color=f8fafc`;
  avatar.alt = `${member.name} avatar`;

  const timelineList = node.querySelector('[data-timeline]');
  if (member.history?.length) {
    for (const item of [...member.history].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))) {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${item.event}</strong><time>${formatDate(item.timestamp)} • ${relativeDate(item.timestamp)}</time><span>${item.detail ?? ''}</span>`;
      timelineList.appendChild(li);
    }
  } else {
    timelineList.innerHTML = '<li>No activity recorded yet.</li>';
  }

  const idCard = node.querySelector('[data-id-card-surface]');
  node.querySelector('[data-id-status]').textContent = statusMeta(member.status).label;
  const idAvatar = node.querySelector('[data-id-avatar]');
  idAvatar.src = avatar.src;
  idAvatar.alt = avatar.alt;
  node.querySelector('[data-id-name]').textContent = member.name;
  node.querySelector('[data-id-plan]').textContent = monthsToLabel(member.planMonths);
  node.querySelector('[data-id-join]').textContent = `Joined: ${formatDate(member.joinDate)}`;
  node.querySelector('[data-id-expiry]').textContent = `Valid till: ${formatDate(member.expiryDate)}`;
  node.querySelector('[data-id-code]').textContent = `ID: ${member.id}`;
  node.querySelector('[data-id-phone]').textContent = member.phone || '—';

  node.querySelector('[data-download-id]').addEventListener('click', () =>
    downloadIdCard(member, idCard),
  );
  node.querySelector('[data-share-id]').addEventListener('click', () =>
    shareIdCard(member),
  );
  node.querySelector('[data-edit-member]').addEventListener('click', () =>
    openMemberModal(member),
  );

  dom.detailContent.innerHTML = '';
  dom.detailContent.appendChild(node);
}

function openMemberModal(member = null) {
  modalState.open = true;
  modalState.editMemberId = member?.id ?? null;
  dom.memberModal.hidden = false;
  dom.modalBackdrop.hidden = false;
  dom.memberModalTitle.textContent = member ? 'Update Member' : 'Create Member';
  dom.memberForm.reset();
  const defaults = state.settings;
  dom.memberForm.memberPlan.value = defaults.defaultPlan ?? 12;
  dom.memberForm.memberFee.value = defaults.defaultFee ?? 1200;
  const today = toISODate(new Date());
  dom.memberForm.memberJoin.value = member?.joinDate ?? today;
  dom.memberForm.memberExpiry.value = member?.expiryDate ?? today;
  if (member) {
    dom.memberForm.memberName.value = member.name;
    dom.memberForm.memberPhone.value = member.phone;
    dom.memberForm.memberPlace.value = member.place;
    dom.memberForm.memberPlan.value = member.planMonths;
    dom.memberForm.memberFee.value = member.fee;
    dom.memberForm.memberJoin.value = member.joinDate;
    dom.memberForm.memberExpiry.value = member.expiryDate;
    dom.memberForm.memberStatus.value = member.status;
    dom.memberForm.memberNotes.value = member.notes ?? '';
    dom.memberForm.memberAvatar.value = member.avatarUrl ?? '';
  } else {
    dom.memberForm.memberStatus.value = 'active';
  }
  dom.memberForm.memberName.focus();
}

function closeMemberModal() {
  modalState.open = false;
  modalState.editMemberId = null;
  dom.memberModal.hidden = true;
  dom.modalBackdrop.hidden = true;
}

async function onMemberFormSubmit(event) {
  event.preventDefault();
  const formData = new FormData(dom.memberForm);
  const payload = {
    id:
      modalState.editMemberId ??
      (state.settings.autoId ? generateMemberId('GYM') : crypto.randomUUID()),
    name: formData.get('name').trim(),
    phone: formData.get('phone').trim(),
    place: formData.get('place').trim(),
    planMonths: Number(formData.get('planMonths')),
    fee: Number(formData.get('fee')),
    joinDate: formData.get('joinDate'),
    expiryDate: formData.get('expiryDate'),
    status: formData.get('status'),
    notes: formData.get('notes').trim(),
    avatarUrl: formData.get('avatarUrl').trim(),
  };
  if (!payload.name) {
    pushToast('Name is required.', 'warning');
    return;
  }
  if (!payload.joinDate || !payload.expiryDate) {
    pushToast('Join and expiry dates are required.', 'warning');
    return;
  }
  if (modalState.editMemberId) {
    updateMember(payload);
  } else {
    createMember(payload);
  }
  closeMemberModal();
  renderMembers();
  renderDashboard();
  if (state.selectedMemberId === payload.id) {
    renderDetail();
  }
  await syncToGitHub('Update member roster');
}

function createMember(payload) {
  const member = {
    ...payload,
    payment: {
      amount: payload.fee,
      paidAt: new Date().toISOString(),
      mode: 'cash',
    },
    history: [
      generateTimelineEntry('Profile created', `Plan: ${monthsToLabel(payload.planMonths)}`),
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  state.members.push(member);
  state.selectedMemberId = member.id;
  state.pendingSync = true;
  pushToast(`${member.name} added to roster.`, 'success');
}

function updateMember(payload) {
  const index = state.members.findIndex((m) => m.id === payload.id);
  if (index === -1) return;
  const existing = state.members[index];
  const updated = {
    ...existing,
    ...payload,
    history: [
      ...(existing.history ?? []),
      generateTimelineEntry('Profile updated', 'Manual edit from manager app'),
    ],
    updatedAt: new Date().toISOString(),
  };
  state.members.splice(index, 1, updated);
  state.selectedMemberId = updated.id;
  state.pendingSync = true;
  pushToast(`${updated.name} updated.`, 'success');
}

function markAsPaid(memberId) {
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return;
  member.status = 'active';
  member.payment = {
    amount: member.fee,
    paidAt: new Date().toISOString(),
    mode: 'cash',
  };
  member.history ??= [];
  member.history.push(generateTimelineEntry('Payment received', formatCurrency(member.fee)));
  member.updatedAt = new Date().toISOString();
  pushToast(`${member.name} marked as paid.`, 'success');
  state.pendingSync = true;
  renderMembers();
  if (state.selectedMemberId === memberId) {
    renderDetail();
  }
  syncToGitHub('Mark payment received');
}

function openRowMenu(event, memberId) {
  event.stopPropagation();
  closeRowMenus();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <button data-action="pending">Mark Pending</button>
    <button data-action="pause">Pause</button>
    <button data-action="expired">Set Expired</button>
    <button data-action="archive">Archive</button>
    <button data-action="delete" class="danger">Delete</button>
  `;
  document.body.appendChild(menu);
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.top = `${rect.bottom + window.scrollY + 6}px`;
  menu.style.left = `${rect.right + window.scrollX - 140}px`;
  const handler = (action) => {
    handleRowAction(memberId, action);
    closeRowMenus();
  };
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    handler(btn.dataset.action);
  });
  document.addEventListener(
    'click',
    () => {
      closeRowMenus();
    },
    { once: true },
  );
}

function closeRowMenus() {
  document.querySelectorAll('.context-menu').forEach((menu) => menu.remove());
}

function handleRowAction(memberId, action) {
  const member = state.members.find((m) => m.id === memberId);
  if (!member) return;
  if (action === 'delete') {
    if (!confirm(`Delete ${member.name}? This cannot be undone.`)) return;
    state.members = state.members.filter((m) => m.id !== memberId);
    if (state.selectedMemberId === memberId) {
      clearSelection();
    }
    pushToast(`${member.name} removed from roster.`, 'warning');
  } else if (action === 'archive') {
    member.status = 'archived';
    member.history ??= [];
    member.history.push(generateTimelineEntry('Archived', 'Profile moved to archives'));
    pushToast(`${member.name} archived.`, 'success');
  } else if (action === 'pause') {
    member.status = 'paused';
    member.history ??= [];
    member.history.push(generateTimelineEntry('Membership paused', 'Marked as paused/hold'));
    pushToast(`${member.name} paused.`, 'success');
  } else if (action === 'pending') {
    member.status = 'pending';
    member.history ??= [];
    member.history.push(generateTimelineEntry('Payment pending', 'Follow-up needed'));
    pushToast(`${member.name} moved to pending dues.`, 'warning');
  } else if (action === 'expired') {
    member.status = 'expired';
    member.history ??= [];
    member.history.push(
      generateTimelineEntry('Marked expired', `Expired on ${formatDate(member.expiryDate)}`),
    );
    pushToast(`${member.name} marked expired.`, 'warning');
  }
  member.updatedAt = new Date().toISOString();
  state.pendingSync = true;
  renderMembers();
  if (state.selectedMemberId === memberId) renderDetail();
  syncToGitHub(`Update ${member.name} status`);
}

function updateFilter(key, value) {
  state.filters[key] = value;
  renderMembers();
}

function resetFilters() {
  state.filters = {
    search: '',
    status: 'all',
    plan: 'all',
    joinRange: 'any',
    expiryRange: 'any',
    showInactive: false,
  };
  initFilters();
  renderMembers();
}

function quickView(view) {
  if (view === 'active') {
    state.filters.status = 'active';
  } else if (view === 'pending') {
    state.filters.status = 'pending';
  } else if (view === 'expired') {
    state.filters.status = 'expired';
  } else if (view === 'paused') {
    state.filters.status = 'paused';
  } else if (view === 'archived') {
    state.filters.status = 'archived';
    state.filters.showInactive = true;
  }
  initFilters();
  renderMembers();
}

function updateStatusBanner(message, tone = 'info', ttl) {
  if (!message) {
    dom.statusBanner.hidden = true;
    return;
  }
  dom.statusBanner.textContent = message;
  dom.statusBanner.dataset.tone = tone;
  dom.statusBanner.hidden = false;
  if (ttl) {
    setTimeout(() => {
      if (dom.statusBanner.textContent === message) {
        dom.statusBanner.hidden = true;
      }
    }, ttl);
  }
}

function pushToast(message, tone = 'info', ttl = 3200) {
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  toast.innerHTML = `<span>${message}</span><button aria-label="Dismiss">✕</button>`;
  const close = () => toast.remove();
  toast.querySelector('button').addEventListener('click', close);
  dom.toastStack.appendChild(toast);
  setTimeout(close, ttl);
}

function openSettings() {
  dom.settingsDrawer.hidden = false;
}

function closeSettings() {
  dom.settingsDrawer.hidden = true;
}

async function onSaveSettings(event) {
  event.preventDefault();
  const formData = new FormData(dom.settingsForm);
  state.settings = {
    token: formData.get('githubToken').trim(),
    repoOwner: formData.get('repoOwner').trim(),
    repoName: formData.get('repoName').trim(),
    dataPath: formData.get('dataPath').trim() || 'data/members.json',
    defaultFee: Number(formData.get('defaultFee')) || 1200,
    defaultPlan: Number(formData.get('defaultPlan')) || 12,
    autoId: formData.get('autoId') === 'on',
  };
  saveSettings(state.settings);
  pushToast('Settings saved locally.', 'success');
  closeSettings();
  await refreshFromGitHub();
}

async function onTestConnection() {
  try {
    await testConnection(state.settings);
    pushToast('Connected to GitHub successfully.', 'success');
  } catch (error) {
    pushToast(error.message, 'danger');
  }
}

async function syncToGitHub(message) {
  if (!state.settings.repoOwner || !state.settings.repoName) {
    updateStatusBanner('Connect GitHub repo to sync changes.', 'warning');
    return;
  }
  try {
    updateStatusBanner('Saving changes to GitHub…', 'info');
    await saveMembers(state.settings, state.members, message);
    state.pendingSync = false;
    updateStatusBanner('Changes saved to GitHub.', 'success', 3000);
  } catch (error) {
    pushToast(error.message, 'danger');
    updateStatusBanner(`Sync failed: ${error.message}`, 'danger');
  }
}

async function downloadIdCard(member, idCard) {
  if (!window.html2canvas) {
    pushToast('ID rendering library missing.', 'danger');
    return;
  }
  const clone = idCard.cloneNode(true);
  clone.style.transform = 'scale(1.6)';
  clone.style.transformOrigin = 'top left';
  clone.style.background = idCard.style.background;
  const wrapper = document.createElement('div');
  wrapper.style.padding = '24px';
  wrapper.style.background = '#0f172a';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);
  try {
    const canvas = await window.html2canvas(wrapper, { scale: 2 });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${member.name.replace(/\s+/g, '_')}_GymHQ_ID.png`;
      a.click();
      URL.revokeObjectURL(url);
    });
  } catch (error) {
    pushToast('Failed to render ID card.', 'danger');
    console.error(error);
  } finally {
    wrapper.remove();
  }
}

function shareIdCard(member) {
  const message = encodeURIComponent(
    `Hi ${member.name}! 👋\nYour GymHQ membership is ${statusMeta(member.status).label}.\nPlan: ${monthsToLabel(member.planMonths)}\nValid till: ${formatDate(member.expiryDate)}\nID: ${member.id}\nSee you at the gym! 💪`,
  );
  const phone = member.phone ? `91${member.phone.replace(/\D+/g, '')}` : '';
  const url = `https://wa.me/${phone}?text=${message}`;
  window.open(url, '_blank', 'noopener');
}

function exportRoster() {
  if (state.members.length === 0) {
    pushToast('No data to export yet.', 'warning');
    return;
  }
  const payload = JSON.stringify(state.members, null, 2);
  downloadBlob(payload, `gymhq-roster-${new Date().toISOString().slice(0, 10)}.json`);
  pushToast('Exported roster as JSON.', 'success');
}

bootstrap();
