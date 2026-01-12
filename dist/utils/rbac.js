"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPermission = checkPermission;
const permissionMatrix = {
    Admin: ['*'],
    Manager: ['candidates:read', 'candidates:update', 'documents:read', 'documents:update'],
    Recruiter: ['candidates:read', 'candidates:create', 'documents:create', 'documents:read'],
    Viewer: ['candidates:read']
};
function checkPermission(role, action) {
    if (permissionMatrix[role]?.includes('*'))
        return true;
    return permissionMatrix[role]?.includes(action) || false;
}
