/**
 * Generates a data URL for a text-based placeholder image
 * for templates without a custom image
 */
export function generateTemplatePlaceholder(templateName: string): string {
  // Create a simple gradient background with the template name
  const colors = [
    { bg: "#667eea", text: "#ffffff" }, // Purple
    { bg: "#f093fb", text: "#ffffff" }, // Pink
    { bg: "#4facfe", text: "#ffffff" }, // Blue
    { bg: "#43e97b", text: "#ffffff" }, // Green
    { bg: "#fa709a", text: "#ffffff" }, // Rose
    { bg: "#feca57", text: "#2d3436" }, // Yellow
    { bg: "#48dbfb", text: "#2d3436" }, // Cyan
    { bg: "#ff6b6b", text: "#ffffff" }, // Red
  ];

  // Use template name to consistently select a color
  const hash = templateName.split("").reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
  const colorIndex = Math.abs(hash) % colors.length;
  const color = colors[colorIndex];

  // Truncate name if too long
  const displayName =
    templateName.length > 25 ? templateName.substring(0, 25) + "..." : templateName;

  // Create SVG
  const svg = `
    <svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${color.bg};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${color.bg};stop-opacity:0.7" />
        </linearGradient>
      </defs>
      <rect width="800" height="600" fill="url(#grad)"/>
      <text 
        x="50%" 
        y="50%" 
        font-family="system-ui, -apple-system, sans-serif" 
        font-size="48" 
        font-weight="600" 
        fill="${color.text}" 
        text-anchor="middle" 
        dominant-baseline="middle"
      >
        ${escapeXml(displayName)}
      </text>
    </svg>
  `;

  // Convert to data URL
  const base64 = btoa(svg);
  return `data:image/svg+xml;base64,${base64}`;
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      case '"':
        return "&quot;";
      default:
        return c;
    }
  });
}
