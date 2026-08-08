export function isRelativeUrl(url: string): boolean {
  try {
    new URL(url)
    return false
  } catch (error) {
    return true
  }
}
