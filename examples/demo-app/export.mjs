import { canExportReports } from './access.mjs';
import { pageSize } from './pagination.mjs';

export function exportPage(user, workspace, requestedSize, rows) {
  if (!canExportReports(user, workspace)) throw new Error('Export forbidden');
  return rows.slice(0, pageSize(requestedSize));
}
