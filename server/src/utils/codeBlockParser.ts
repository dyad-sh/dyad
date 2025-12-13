/**
 * Code Block Parser - Extracts files from AI responses
 * Detects various markdown code block formats and extracts file paths and content
 */

export interface ParsedFile {
    path: string;
    content: string;
    language?: string;
}

/**
 * Parse code blocks from AI response and extract files
 * Supports multiple formats:
 * - ```language:path/to/file.ext
 * - ```language path/to/file.ext
 * - // File: path/to/file.ext followed by code block
 * - ### path/to/file.ext followed by code block
 */
export function parseCodeBlocks(aiResponse: string): ParsedFile[] {
    const files: ParsedFile[] = [];
    const lines = aiResponse.split('\n');

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];

        // Pattern 1: ```language:path or ```language path
        const codeBlockMatch = line.match(/^```(\w+)[\s:]+([\w\/\.\-]+\.\w+)/);
        if (codeBlockMatch) {
            const language = codeBlockMatch[1];
            const path = codeBlockMatch[2];
            const contentLines: string[] = [];

            i++; // Move to next line after opening ```
            while (i < lines.length && !lines[i].startsWith('```')) {
                contentLines.push(lines[i]);
                i++;
            }

            if (contentLines.length > 0) {
                files.push({
                    path,
                    content: contentLines.join('\n'),
                    language,
                });
            }
            i++; // Skip closing ```
            continue;
        }

        // Pattern 2: Comment-style file indicator
        const commentMatch = line.match(/^\/\/\s*(?:File|Fichier):\s*([\w\/\.\-]+\.\w+)/i);
        if (commentMatch) {
            const path = commentMatch[1];
            i++; // Move to next line

            // Look for code block on next line or skip empty lines
            while (i < lines.length && lines[i].trim() === '') {
                i++;
            }

            if (i < lines.length && lines[i].startsWith('```')) {
                const langMatch = lines[i].match(/^```(\w+)?/);
                const language = langMatch?.[1];
                const contentLines: string[] = [];

                i++; // Move past opening ```
                while (i < lines.length && !lines[i].startsWith('```')) {
                    contentLines.push(lines[i]);
                    i++;
                }

                if (contentLines.length > 0) {
                    files.push({
                        path,
                        content: contentLines.join('\n'),
                        language,
                    });
                }
                i++; // Skip closing ```
                continue;
            }
        }

        // Pattern 3: Markdown header with file path
        const headerMatch = line.match(/^#{1,4}\s+([\w\/\.\-]+\.\w+)$/);
        if (headerMatch) {
            const path = headerMatch[1];
            i++; // Move to next line

            // Skip empty lines
            while (i < lines.length && lines[i].trim() === '') {
                i++;
            }

            if (i < lines.length && lines[i].startsWith('```')) {
                const langMatch = lines[i].match(/^```(\w+)?/);
                const language = langMatch?.[1];
                const contentLines: string[] = [];

                i++; // Move past opening ```
                while (i < lines.length && !lines[i].startsWith('```')) {
                    contentLines.push(lines[i]);
                    i++;
                }

                if (contentLines.length > 0) {
                    files.push({
                        path,
                        content: contentLines.join('\n'),
                        language,
                    });
                }
                i++; // Skip closing ```
                continue;
            }
        }

        i++;
    }

    return files;
}

/**
 * Normalize file path (remove leading ./ or /)
 */
export function normalizePath(path: string): string {
    return path.replace(/^\.?\//, '');
}

/**
 * Detect language from file extension
 */
export function detectLanguage(path: string): string | undefined {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        'ts': 'typescript',
        'tsx': 'typescript',
        'js': 'javascript',
        'jsx': 'javascript',
        'py': 'python',
        'java': 'java',
        'cpp': 'cpp',
        'c': 'c',
        'go': 'go',
        'rs': 'rust',
        'rb': 'ruby',
        'php': 'php',
        'html': 'html',
        'css': 'css',
        'scss': 'scss',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'md': 'markdown',
        'sql': 'sql',
        'sh': 'bash',
    };
    return ext ? languageMap[ext] : undefined;
}
