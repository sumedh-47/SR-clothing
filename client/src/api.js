const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function apiUrl(path) {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function mediaUrl(path) {
  if (!path) return '';
  if (/^(?:https?:)?\/\//i.test(path)) return path;
  return apiUrl(path);
}
