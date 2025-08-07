import { LanguageModelV1, LanguageModelV1CallOptions } from "ai";
import { ClaudeCodeSimpleProvider } from "./claude_code_simple_provider";
import log from "electron-log";
import * as fs from "fs";
import * as path from "path";

const logger = log.scope("claude-code-model-adapter");

function transformDyadContextForClaudeCode(content: any): string {
  // Ensure content is a string
  if (typeof content !== 'string') {
    if (content && typeof content === 'object') {
      content = JSON.stringify(content);
    } else {
      content = String(content || '');
    }
  }
  
  // Remove Dyad-specific system identity and replace with natural context
  let transformed = content;
  
  // Remove references to being "Dyad" or "an AI assistant named Dyad"
  transformed = transformed.replace(/You are Dyad[^.]*\./g, '');
  transformed = transformed.replace(/I am Dyad[^.]*\./g, '');
  transformed = transformed.replace(/As Dyad[^,]*/g, '');
  transformed = transformed.replace(/\bDyad\b(?!\s*(tags?|write|read))/g, 'the development environment');
  
  // Transform Dyad-specific instructions to natural development context
  transformed = transformed.replace(/Follow these rules when responding:/g, 'Development guidelines:');
  transformed = transformed.replace(/Use <dyad-write>/g, 'When editing files, modify them directly using the available tools.');
  transformed = transformed.replace(/<dyad-write[^>]*>/g, '');
  transformed = transformed.replace(/<\/dyad-write>/g, '');
  transformed = transformed.replace(/<dyad-[^>]*>/g, '');
  transformed = transformed.replace(/<\/dyad-[^>]*>/g, '');
  
  // Transform codebase context to be more natural
  if (transformed.includes('This is my codebase')) {
    transformed = transformed.replace('This is my codebase.', 'You are working with a codebase that contains:');
  }
  
  // Add natural context for file editing
  if (transformed.includes('You can edit files')) {
    transformed += '\n\nYou have direct access to edit, create, and modify files in this project directory. Feel free to make changes as needed to fulfill the user\'s requests.';
  }
  
  return transformed.trim();
}

function transformClaudeCodeResponseForDyad(response: string, cwd?: string): string {
  // Claude Code will naturally edit files and explain what it did
  // We need to detect file changes and wrap them in Dyad tags
  let transformed = response;
  
  // If Claude Code mentions creating or editing files, we need to check for actual file changes
  // Since Claude Code runs with file access, it will have actually made the changes
  // We just need to format the response to match Dyad's expectations
  
  // Look for common patterns that indicate file operations with filename extraction
  const fileOperationPatterns = [
    /I(?:'ve|'ll| will| have)?\s+(created?|added?|modified?|edited?|updated?|changed?)\s+(?:the\s+)?(?:file\s+)?[`"']?([^`"'\s]+\.[a-zA-Z]+)[`"']?/gi,
    /(?:Created?|Added?|Modified?|Edited?|Updated?|Changed?)\s+(?:the\s+)?(?:file\s+)?[`"']?([^`"'\s]+\.[a-zA-Z]+)[`"']?/gi,
    /(?:File|The file)\s+[`"']?([^`"'\s]+\.[a-zA-Z]+)[`"']?\s+(?:has been|was)\s+(?:created?|added?|modified?|edited?|updated?|changed?)/gi
  ];
  
  // Extract mentioned files and try to read their content
  const mentionedFiles = new Set<string>();
  
  for (const pattern of fileOperationPatterns) {
    let match;
    while ((match = pattern.exec(response)) !== null) {
      const filename = match[2] || match[1]; // Different capture groups for different patterns
      if (filename && filename.includes('.')) {
        mentionedFiles.add(filename);
      }
    }
  }
  
  // If we found file operations, try to read the actual file content and wrap in Dyad tags
  if (mentionedFiles.size > 0) {
    const workingDir = cwd || process.cwd();
    
    let dyadTags = '';
    
    for (const filename of mentionedFiles) {
      try {
        const filePath = path.resolve(workingDir, filename);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          dyadTags += `\n\n<dyad-write path="${filename}">\n${content}\n</dyad-write>`;
        }
      } catch (error) {
        logger.warn(`Failed to read file ${filename} for Dyad integration:`, error);
      }
    }
    
    // Add the Dyad tags to the response so Dyad can detect the file changes
    if (dyadTags) {
      transformed = response + dyadTags + "\n\nNote: Files have been directly modified using Claude Code's file access capabilities.";
    } else {
      transformed = response + "\n\nNote: Files have been directly modified using Claude Code's file access capabilities.";
    }
  }
  
  return transformed;
}

function convertPromptToText(prompt: any): string {
  if (typeof prompt === "string") {
    return transformDyadContextForClaudeCode(prompt);
  }
  
  if (Array.isArray(prompt)) {
    return prompt
      .map((message: any) => {
        if (typeof message === "string") {
          return transformDyadContextForClaudeCode(message);
        }
        if (message.role && message.content) {
          let content = message.content;
          
          // Transform system messages to be natural instructions
          if (message.role === "system") {
            content = transformDyadContextForClaudeCode(content);
            return content; // Don't prefix system messages with "system:"
          }
          
          // Transform user/assistant messages normally
          content = transformDyadContextForClaudeCode(content);
          return `${message.role}: ${content}`;
        }
        return JSON.stringify(message);
      })
      .join("\n\n");
  }
  
  return JSON.stringify(prompt);
}

export function createClaudeCodeModelAdapter(cwd?: string, options?: { timeout?: number }): LanguageModelV1 {
  const provider = new ClaudeCodeSimpleProvider(options);
  
  return {
    specificationVersion: "v1",
    provider: "claude-code",
    modelId: "claude-code",
    supportsStructuredOutputs: false,
    supportsImageUrls: false,
    supportsUrl: (_url: URL) => false,
    defaultObjectGenerationMode: undefined,

    async doGenerate(options: LanguageModelV1CallOptions) {
      try {
        const { prompt, abortSignal } = options;
        
        logger.info("Claude Code doGenerate called with cwd:", cwd);
        
        // Initialize provider if not already done
        try {
          await provider.initialize();
        } catch (error) {
          logger.error("Failed to initialize Claude Code provider:", error);
          throw error;
        }
        
        // Convert prompt to text, keeping all context including system information
        const promptText = convertPromptToText(prompt);
        logger.info(`Sending request to Claude Code with full prompt length: ${promptText.length} (including all context)`);
        
        // Check for abort signal
        if (abortSignal?.aborted) {
          throw new Error("Request aborted");
        }
        
        const response = await provider.generateResponse(promptText, cwd);
        
        // Transform Claude Code's response to be Dyad-compatible
        const transformedResponse = transformClaudeCodeResponseForDyad(response, cwd);
        
        return {
          text: transformedResponse,
          finishReason: "stop" as const,
          usage: {
            promptTokens: Math.ceil(promptText.length / 4),
            completionTokens: Math.ceil(transformedResponse.length / 4),
          },
          rawCall: {
            rawPrompt: prompt,
            rawSettings: {},
          },
          response: {
            id: `claude-code-${Date.now()}`,
            timestamp: new Date(),
            modelId: "claude-code",
          },
          warnings: [],
        };
      } catch (error) {
        logger.error("Claude Code generation failed:", error);
        throw error;
      }
    },

    async doStream(options: LanguageModelV1CallOptions) {
      // For now, just return the full response as a single chunk
      const result = await this.doGenerate(options);
      
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "text-delta" as const,
              textDelta: result.text || "",
            });
            controller.enqueue({
              type: "finish" as const,
              finishReason: result.finishReason,
              usage: result.usage,
            });
            controller.close();
          },
          cancel(reason) {
            logger.info("Claude Code stream cancelled:", reason);
          },
        }),
        rawCall: result.rawCall,
      };
    },
  };
}