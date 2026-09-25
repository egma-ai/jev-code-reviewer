export function pageSize(requested) {
  const size = Number(requested);
  if (!Number.isFinite(size) || size < 1) return 20;
  return Math.min(Math.floor(size), 100);
}
