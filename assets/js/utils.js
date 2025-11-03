const MONTH_LABELS = {
  1: '1 Month',
  3: '3 Months',
  6: '6 Months',
  12: '1 Year',
};

const STATUS_CONFIG = {
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  expired: { label: 'Expired', tone: 'danger' },
  paused: { label: 'Paused', tone: 'info' },
  archived: { label: 'Archived', tone: 'muted' },
};

export function formatDate(value) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function toISODate(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

export function formatCurrency(amount) {
  if (Number.isNaN(Number(amount))) return '₹0';
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `₹${Number(amount).toLocaleString('en-IN')}`;
  }
}

export function monthsToLabel(months) {
  return MONTH_LABELS[months] ?? `${months} Months`;
}

export function statusMeta(status) {
  return STATUS_CONFIG[status] ?? { label: 'Unknown', tone: 'muted' };
}

export function hasExpired(expiry) {
  if (!expiry) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiryDate = new Date(expiry);
  return expiryDate < today;
}

export function isSoon(expiry, days = 7) {
  if (!expiry) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limit = new Date(today);
  limit.setDate(limit.getDate() + days);
  const expiryDate = new Date(expiry);
  return expiryDate >= today && expiryDate <= limit;
}

export function calculateExpiry(joinDate, months) {
  if (!joinDate || !months) return '';
  const result = new Date(joinDate);
  const monthsInt = parseInt(months, 10);
  if (Number.isNaN(monthsInt)) return '';
  result.setMonth(result.getMonth() + monthsInt);
  result.setDate(result.getDate() - 1);
  return toISODate(result);
}

export function generateTimelineEntry(event, detail = '') {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    event,
    detail,
  };
}

export function generateMemberId(prefix = 'GYM', seed = undefined) {
  const random = seed ?? Math.random();
  const number = Math.floor(random * 999999).toString().padStart(6, '0');
  return `${prefix}-${number}`;
}

export function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D+/g, '').replace(/^0+/, '');
}

export function matchesQuery(member, query) {
  if (!query) return true;
  const haystack = [
    member.name,
    member.phone,
    member.place,
    member.id,
    member.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function relativeDate(value) {
  if (!value) return '';
  const now = new Date();
  const target = new Date(value);
  const delta = target - now;
  const day = 24 * 60 * 60 * 1000;
  const diffDays = Math.round(delta / day);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  if (diffDays > 0) return `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
  return `${Math.abs(diffDays)} day${diffDays === -1 ? '' : 's'} ago`;
}

export function getPlanDuration(expiry, join) {
  if (!expiry || !join) return '—';
  const start = new Date(join);
  const end = new Date(expiry);
  if (Number.isNaN(start) || Number.isNaN(end)) return '—';
  const totalMonths = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
  return monthsToLabel(totalMonths);
}

export function computeDashboardMetrics(members) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const metrics = {
    total: members.length,
    active: 0,
    pending: 0,
    expired: 0,
    revenue: 0,
  };
  for (const member of members) {
    if (member.status === 'active') metrics.active += 1;
    if (member.status === 'pending') metrics.pending += 1;
    if (member.status === 'expired') metrics.expired += 1;
    const paidAt = member.payment?.paidAt ? new Date(member.payment.paidAt) : null;
    if (paidAt && paidAt >= startOfMonth) {
      metrics.revenue += Number(member.payment?.amount ?? 0);
    }
  }
  return metrics;
}

export function groupMembersByStatus(members) {
  return members.reduce(
    (acc, member) => {
      const status = member.status ?? 'unknown';
      acc[status] ??= [];
      acc[status].push(member);
      return acc;
    },
    {},
  );
}

export function downloadBlob(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
