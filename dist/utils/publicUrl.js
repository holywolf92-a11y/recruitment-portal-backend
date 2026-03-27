"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_BACKEND_URL = exports.CANONICAL_FRONTEND_URL = void 0;
exports.resolveFrontendUrl = resolveFrontendUrl;
exports.resolveBackendBaseUrl = resolveBackendBaseUrl;
exports.resolveBackendApiBaseUrl = resolveBackendApiBaseUrl;
exports.CANONICAL_FRONTEND_URL = 'https://falishajobs.up.railway.app';
exports.CANONICAL_BACKEND_URL = 'https://glorious-flexibility-production.up.railway.app';
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
function resolveFrontendUrl(url) {
    const normalized = (url || '').trim().replace(/\/$/, '');
    if (!normalized) {
        return exports.CANONICAL_FRONTEND_URL;
    }
    if (LEGACY_FRONTEND_HOSTS.some((host) => normalized.includes(host))) {
        return exports.CANONICAL_FRONTEND_URL;
    }
    return normalized;
}
function resolveBackendBaseUrl(url) {
    const normalized = (url || '').trim().replace(/\/$/, '');
    if (!normalized) {
        return exports.CANONICAL_BACKEND_URL;
    }
    if (LEGACY_BACKEND_HOSTS.some((host) => normalized.includes(host))) {
        return exports.CANONICAL_BACKEND_URL;
    }
    return normalized;
}
function resolveBackendApiBaseUrl(url) {
    const baseUrl = resolveBackendBaseUrl(url);
    return baseUrl.endsWith('/api') ? baseUrl : `${baseUrl}/api`;
}
