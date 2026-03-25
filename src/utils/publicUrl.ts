export const CANONICAL_FRONTEND_URL = 'https://falishajobs.up.railway.app';
export const CANONICAL_BACKEND_URL = 'https://glorious-flexibility-production.up.railway.app';

const LEGACY_FRONTEND_HOSTS = [
  'falishamanpower.up.railway.app',
  'recruitment-portal-frontend-production.up.railway.app',
  'exquisite-surprise-production.up.railway.app',
  'falishamanpower.com',
];

const LEGACY_BACKEND_HOSTS = [
  'recruitment-portal-backend-production-d1f7.up.railway.app',
  'recruitment-portal-backend-production-2475.up.railway.app',
  'recruitment-portal-backend.up.railway.app',
];

export function resolveFrontendUrl(url?: string | null): string {
  const normalized = (url || '').trim().replace(/\/$/, '');

  if (!normalized) {
    return CANONICAL_FRONTEND_URL;
  }

  if (LEGACY_FRONTEND_HOSTS.some((host) => normalized.includes(host))) {
    return CANONICAL_FRONTEND_URL;
  }

  return normalized;
}

export function resolveBackendBaseUrl(url?: string | null): string {
  const normalized = (url || '').trim().replace(/\/$/, '');

  if (!normalized) {
    return CANONICAL_BACKEND_URL;
  }

  if (LEGACY_BACKEND_HOSTS.some((host) => normalized.includes(host))) {
    return CANONICAL_BACKEND_URL;
  }

  return normalized;
}

export function resolveBackendApiBaseUrl(url?: string | null): string {
  const baseUrl = resolveBackendBaseUrl(url);
  return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
}