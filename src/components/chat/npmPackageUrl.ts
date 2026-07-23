export function getNpmPackagePageUrl(packageSpec: string): string {
  let packageName = packageSpec;

  if (packageSpec.startsWith("@")) {
    const slashIndex = packageSpec.indexOf("/");
    const selectorIndex =
      slashIndex === -1 ? -1 : packageSpec.indexOf("@", slashIndex);
    if (selectorIndex !== -1) {
      packageName = packageSpec.slice(0, selectorIndex);
    }
  } else {
    const selectorIndex = packageSpec.indexOf("@");
    if (selectorIndex !== -1) {
      packageName = packageSpec.slice(0, selectorIndex);
    }
  }

  return `https://www.npmjs.com/package/${packageName}`;
}
