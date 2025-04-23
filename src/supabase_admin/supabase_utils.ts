export function isServerFunction(filePath: string) {
  return filePath.startsWith("supabase/functions/");
}
