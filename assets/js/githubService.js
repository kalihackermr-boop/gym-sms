import { rememberSha, getRememberedSha, clearSha } from './storage.js';

const BASE_URL = 'https://api.github.com';

function headers(settings) {
  const hdrs = {
    Accept: 'application/vnd.github+json',
  };
  if (settings.token) {
    hdrs.Authorization = `Bearer ${settings.token}`;
  }
  return hdrs;
}

function isConfigured(settings) {
  return Boolean(settings.repoOwner && settings.repoName && settings.dataPath);
}

export async function fetchMembers(settings) {
  if (!isConfigured(settings)) {
    throw new Error('GitHub settings incomplete');
  }
  const url = `${BASE_URL}/repos/${settings.repoOwner}/${settings.repoName}/contents/${settings.dataPath}`;
  const resp = await fetch(url, { headers: headers(settings) });
  if (resp.status === 404) {
    clearSha(settings.dataPath);
    return { members: [], sha: null };
  }
  if (!resp.ok) {
    const msg = await safeErrorMessage(resp);
    throw new Error(`GitHub fetch failed: ${msg}`);
  }
  const data = await resp.json();
  const decoded = atob(data.content.replace(/\n/g, ''));
  let members = [];
  if (decoded.trim().length) {
    try {
      members = JSON.parse(decoded);
    } catch (error) {
      console.error('Failed parsing members.json', error);
      throw new Error('Invalid JSON in data file — fix the file on GitHub to continue.');
    }
  }
  rememberSha(settings.dataPath, data.sha);
  return { members, sha: data.sha };
}

export async function saveMembers(settings, members, message = 'Update members roster') {
  if (!isConfigured(settings)) {
    throw new Error('GitHub settings incomplete');
  }
  const url = `${BASE_URL}/repos/${settings.repoOwner}/${settings.repoName}/contents/${settings.dataPath}`;
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(members, null, 2))));
  const sha = getRememberedSha(settings.dataPath);
  const body = {
    message,
    content,
    committer: {
      name: 'GymHQ Bot',
      email: 'bot@gymhq.local',
    },
  };
  if (sha) body.sha = sha;
  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers(settings),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const msg = await safeErrorMessage(resp);
    if (resp.status === 409) {
      clearSha(settings.dataPath);
    }
    throw new Error(`GitHub save failed: ${msg}`);
  }
  const data = await resp.json();
  rememberSha(settings.dataPath, data.content.sha);
  return data;
}

export async function testConnection(settings) {
  if (!isConfigured(settings)) {
    throw new Error('Fill owner, repo, and path before testing connection.');
  }
  const url = `${BASE_URL}/repos/${settings.repoOwner}/${settings.repoName}`;
  const resp = await fetch(url, { headers: headers(settings) });
  if (!resp.ok) {
    const msg = await safeErrorMessage(resp);
    throw new Error(`Cannot reach repository: ${msg}`);
  }
  return resp.json();
}

async function safeErrorMessage(resp) {
  let text;
  try {
    const data = await resp.json();
    text = data.message ?? JSON.stringify(data);
  } catch {
    text = await resp.text();
  }
  return `${resp.status} ${resp.statusText} — ${text}`;
}
