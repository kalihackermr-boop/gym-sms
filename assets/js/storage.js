const SETTINGS_KEY = 'gymhq.settings.v1';
const SHA_KEY = 'gymhq.sha.v1';

const DEFAULTS = {
  repoOwner: '',
  repoName: '',
  dataPath: 'data/members.json',
  defaultFee: 1200,
  defaultPlan: 12,
  autoId: true,
  token: '',
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch (error) {
    console.warn('Failed to parse settings', error);
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  const persistable = { ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(persistable));
}

export function rememberSha(path, sha) {
  const map = loadShaMap();
  map[path] = sha;
  localStorage.setItem(SHA_KEY, JSON.stringify(map));
}

export function getRememberedSha(path) {
  const map = loadShaMap();
  return map[path];
}

function loadShaMap() {
  try {
    const raw = localStorage.getItem(SHA_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function clearSha(path) {
  const map = loadShaMap();
  delete map[path];
  localStorage.setItem(SHA_KEY, JSON.stringify(map));
}
