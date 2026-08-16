import fs from "node:fs/promises";
import path from "node:path";

export const PREVIEW_APP_TITLE = "MetaHuman OS APP";
export const PREVIEW_FAVICON_PATH = "/meta-human-os.svg";

const PREVIEW_FAVICON = `<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="metaHumanGradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#00E5FF"/><stop offset="50%" stop-color="#00FFC8"/><stop offset="100%" stop-color="#0099FF"/></linearGradient></defs>
  <rect width="512" height="512" rx="112" fill="#050B14"/>
  <path d="M256 52 426 150v212L256 460 86 362V150L256 52Z" stroke="url(#metaHumanGradient)" stroke-width="18" opacity=".52"/>
  <path d="M256 112 374 180v152L256 400 138 332V180L256 112Z" stroke="url(#metaHumanGradient)" stroke-width="12" opacity=".85"/>
  <path d="M256 174 320 211v90L256 338 192 301v-90l64-37Z" fill="url(#metaHumanGradient)" fill-opacity=".12" stroke="url(#metaHumanGradient)" stroke-width="10"/>
  <circle cx="256" cy="256" r="31" fill="url(#metaHumanGradient)"/>
  <circle cx="256" cy="256" r="48" stroke="#A7FFF2" stroke-width="5" opacity=".48"/>
</svg>\n`;

const ICON_LINK_PATTERN =
  /<link\b(?=[^>]*\brel\s*=\s*["'][^"']*icon[^"']*["'])[^>]*>\s*/gi;
const TITLE_PATTERN = /<title\b[^>]*>[\s\S]*?<\/title>/i;

export function applyPreviewBrandingToHtml(html: string): string {
  let branded = html.replace(ICON_LINK_PATTERN, "");
  const title = `<title>${PREVIEW_APP_TITLE}</title>`;
  const favicon = `<link rel="icon" type="image/svg+xml" href="${PREVIEW_FAVICON_PATH}" />`;

  if (TITLE_PATTERN.test(branded)) {
    branded = branded.replace(TITLE_PATTERN, `${title}\n    ${favicon}`);
  } else if (/<head\b[^>]*>/i.test(branded)) {
    branded = branded.replace(
      /<head\b[^>]*>/i,
      `$&\n    ${title}\n    ${favicon}`,
    );
  }
  return branded;
}

/**
 * Give generated apps stable browser metadata before any preview runtime reads
 * the directory. This covers host, Docker and cloud previews, including apps
 * created before the scaffold adopted the MetaHuman branding.
 */
export async function ensurePreviewBranding(appPath: string): Promise<boolean> {
  const indexPath = path.join(appPath, "index.html");
  let html: string;
  try {
    html = await fs.readFile(indexPath, "utf8");
  } catch {
    // Frameworks without a root index.html own their document metadata.
    return false;
  }

  const branded = applyPreviewBrandingToHtml(html);
  const publicPath = path.join(appPath, "public");
  const faviconPath = path.join(publicPath, "meta-human-os.svg");
  await fs.mkdir(publicPath, { recursive: true });
  await Promise.all([
    branded === html ? Promise.resolve() : fs.writeFile(indexPath, branded),
    fs.writeFile(faviconPath, PREVIEW_FAVICON),
  ]);
  return branded !== html;
}
