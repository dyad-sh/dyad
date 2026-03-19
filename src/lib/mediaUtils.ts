export function filterMediaAppsByQuery<
  T extends { appName: string; files: { fileName: string }[] },
>(apps: T[], query: string): T[] {
  const trimmed = query.trim();
  if (!trimmed) return apps;
  const q = trimmed.toLowerCase();
  return apps.filter(
    (app) =>
      app.appName.toLowerCase().includes(q) ||
      app.files.some((f) => f.fileName.toLowerCase().includes(q)),
  );
}
