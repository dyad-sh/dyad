export function filterMediaAppsByQuery<
  T extends { appName: string; files: { fileName: string }[] },
>(apps: T[], query: string): T[] {
  if (!query.trim()) return apps;
  const q = query.toLowerCase();
  return apps.filter(
    (app) =>
      app.appName.toLowerCase().includes(q) ||
      app.files.some((f) => f.fileName.toLowerCase().includes(q)),
  );
}
