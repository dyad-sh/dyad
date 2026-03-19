export function getFileNameWithoutExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) return fileName;
  return fileName.slice(0, fileName.length - extension.length);
}

export function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf(".");
  if (lastDotIndex <= 0) return "";
  return fileName.slice(lastDotIndex);
}
