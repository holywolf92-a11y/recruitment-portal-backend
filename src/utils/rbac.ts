export type Role = 'Admin' | 'Manager' | 'Recruiter' | 'Viewer';

const permissionMatrix: Record<Role, string[]> = {
  Admin: ['*'],
  Manager: ['candidates:read', 'candidates:update', 'documents:read', 'documents:update'],
  Recruiter: ['candidates:read', 'candidates:create', 'documents:create', 'documents:read'],
  Viewer: ['candidates:read']
};

export function checkPermission(role: Role | string, action: string) {
  if ((permissionMatrix as any)[role]?.includes('*')) return true;
  return (permissionMatrix as any)[role]?.includes(action) || false;
}
