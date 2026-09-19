// Demonstration code only. No real authorization system uses this helper.
export function canExportReports(user, workspace) {
  return user.role === 'admin';
}
