"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveProfilePhotoStorageRef = deriveProfilePhotoStorageRef;
const PUBLIC_MARKER = '/storage/v1/object/public/';
const SIGN_MARKER = '/storage/v1/object/sign/';
function deriveProfilePhotoStorageRef(profilePhotoUrl) {
    const raw = String(profilePhotoUrl || '').trim();
    if (!raw) {
        return null;
    }
    if (raw.includes(PUBLIC_MARKER)) {
        const rest = raw.substring(raw.indexOf(PUBLIC_MARKER) + PUBLIC_MARKER.length);
        const parts = rest.split('/').filter(Boolean);
        const bucket = parts.shift();
        const storagePath = parts.join('/');
        return bucket && storagePath ? { bucket, storagePath } : null;
    }
    if (raw.includes(SIGN_MARKER)) {
        const rest = raw.substring(raw.indexOf(SIGN_MARKER) + SIGN_MARKER.length).split('?')[0];
        const parts = rest.split('/').filter(Boolean);
        const bucket = parts.shift();
        const storagePath = parts.join('/');
        return bucket && storagePath ? { bucket, storagePath } : null;
    }
    if (/^[a-z0-9_-]+\/candidate_photos\//i.test(raw)) {
        const parts = raw.split('/').filter(Boolean);
        const bucket = parts.shift();
        const storagePath = parts.join('/');
        return bucket && storagePath ? { bucket, storagePath } : null;
    }
    if (/^candidate_photos\//i.test(raw)) {
        return { bucket: 'documents', storagePath: raw };
    }
    return null;
}
