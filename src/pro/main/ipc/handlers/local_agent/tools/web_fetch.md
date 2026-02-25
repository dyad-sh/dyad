# Web Fetch Tool

The `web_fetch` tool allows the local agent to fetch content from URLs and return it in various formats.

## Features

- **Multiple Format Support**: Returns content as HTML, Markdown, or plain text
- **Image Handling**: Automatically detects and handles image responses, converting them to base64 data URLs
- **Smart Content Conversion**:
  - HTML to Markdown conversion for better readability
  - Text extraction from HTML (removes scripts, styles, and other non-content elements)
- **Security**:
  - URL validation (must start with http:// or https://)
  - Size limits (max 5MB)
  - Configurable timeouts (default 30s, max 120s)
- **Cloudflare Protection**: Automatically retries with a different User-Agent if blocked by Cloudflare bot detection

## Parameters

```typescript
{
  url: string;           // The URL to fetch (required, must start with http:// or https://)
  format?: "text" | "markdown" | "html";  // Output format (default: "markdown")
  timeout?: number;      // Timeout in seconds (default: 30, max: 120)
}
```

## Usage Examples

### Fetch documentation as markdown (default)

```typescript
{
  "url": "https://docs.example.com/api",
  "format": "markdown"
}
```

### Fetch plain text

```typescript
{
  "url": "https://example.com/article",
  "format": "text"
}
```

### Fetch raw HTML

```typescript
{
  "url": "https://example.com/page",
  "format": "html"
}
```

### Fetch with custom timeout

```typescript
{
  "url": "https://slow-server.com/data",
  "timeout": 60
}
```

## Implementation Details

### Format Conversion

#### Markdown Format

When `format: "markdown"` is specified:

- If the response is HTML, it's converted to Markdown using a built-in converter
- Headings, links, images, lists, code blocks, bold, and italic are preserved
- Script, style, meta, and link tags are removed
- If the response is already text/markdown, it's returned as-is

#### Text Format

When `format: "text"` is specified:

- If the response is HTML, all HTML tags are stripped
- Script, style, and other non-content elements are removed
- HTML entities are decoded
- Whitespace is normalized
- If the response is already plain text, it's returned as-is

#### HTML Format

When `format: "html"` is specified:

- The raw HTML response is returned without modification

### Image Handling

When the response Content-Type indicates an image (e.g., `image/jpeg`, `image/png`):

1. The image is converted to a base64-encoded data URL
2. The image is added to the conversation via `ctx.appendUserMessage` so the model can see it
3. Returns a success message instead of the raw image data

Excluded from image handling:

- `image/svg+xml` (treated as text)
- `image/vnd.fastbidsheet` (treated as text)

### Accept Headers

The tool sends appropriate Accept headers based on the requested format:

- **Markdown**: Prefers markdown, falls back to plain text, then HTML
- **Text**: Prefers plain text, falls back to markdown, then HTML
- **HTML**: Prefers HTML, falls back to XHTML, then text

### Timeout Handling

- Default timeout: 30 seconds
- Maximum timeout: 120 seconds
- Timeouts can be customized per request
- Requests exceeding the timeout are aborted and throw an error

### Size Limits

- Maximum response size: 5MB
- Checked both via Content-Length header and actual response size
- Exceeding the limit throws an error

### Cloudflare Bot Detection

If a request fails with:

- Status code 403
- Header `cf-mitigated: challenge`

The tool automatically retries with a different User-Agent (`dyad-agent` instead of the Chrome UA).

## Testing

The tool includes comprehensive tests covering:

- URL validation
- Format conversion (HTML to markdown/text)
- Image handling
- Size limits
- Timeout handling
- Error handling
- Cloudflare challenge handling

Run tests with:

```bash
npm test -- web_fetch.spec.ts
```

## Comparison with Web Crawl Tool

| Feature        | `web_fetch`              | `web_crawl`                  |
| -------------- | ------------------------ | ---------------------------- |
| Purpose        | Fetch single URL content | Clone/replicate websites     |
| Output         | Text/HTML/Markdown       | HTML + Markdown + Screenshot |
| Image handling | Returns as data URL      | Returns placeholder SVG      |
| Use case       | Read content, docs, APIs | Clone website structure      |
| Pro only       | No                       | Yes (requires Dyad Pro)      |

## Implementation Notes

- The HTML to Markdown conversion is a basic implementation using regex
- For production use with complex HTML, consider integrating a library like `turndown`
- The text extraction is also regex-based and handles common HTML patterns
- Both converters handle HTML entity decoding for common entities
