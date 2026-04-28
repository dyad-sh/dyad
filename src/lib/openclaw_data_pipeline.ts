/**
 * OpenClaw Data Pipeline Service
 *
 * Integrates scraping, data collection, and image generation with
 * AI-powered processing using local Ollama (preferred) or Anthropic fallback.
 *
 * Features:
 * - AI-enhanced web scraping with intelligent content extraction
 * - AI-powered prompt enhancement for image generation
 * - Data pipeline orchestration with AI transformations
 * - Local-first AI processing with cloud fallback
 */

import { EventEmitter } from "events";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import type {
  OpenClawScrapingConfig,
  OpenClawScrapingResult,
  OpenClawImageGenConfig,
  OpenClawImageGenResult,
  OpenClawDataPipelineConfig,
  OpenClawPipelineResult,
  OpenClawDataRequest,
  OpenClawDataResponse,
  OpenClawConfig,
  OpenClawChatRequest,
} from "@/types/openclaw_types";
import {
  DEFAULT_SCRAPING_CONFIG,
  DEFAULT_IMAGE_GEN_CONFIG,
  DEFAULT_OPENCLAW_CONFIG,
} from "@/types/openclaw_types";

const logger = log.scope("OpenClaw-data-pipeline");

// =============================================================================
// Types
// =============================================================================

interface DataJob {
  id: string;
  type: "scrape" | "image-gen" | "pipeline";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  startedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

interface AIProviderConnection {
  type: "ollama" | "anthropic";
  baseURL: string;
  apiKey?: string;
  model: string;
  available: boolean;
}

// =============================================================================
// OpenClaw Data Pipeline Service
// =============================================================================

export class OpenClawDataPipelineService extends EventEmitter {
  private static instance: OpenClawDataPipelineService | null = null;
  
  private config: OpenClawConfig;
  private jobs: Map<string, DataJob> = new Map();
  private ollamaConnection: AIProviderConnection | null = null;
  private anthropicConnection: AIProviderConnection | null = null;
  
  private constructor() {
    super();
    this.config = DEFAULT_OPENCLAW_CONFIG;
  }
  
  static getInstance(): OpenClawDataPipelineService {
    if (!OpenClawDataPipelineService.instance) {
      OpenClawDataPipelineService.instance = new OpenClawDataPipelineService();
    }
    return OpenClawDataPipelineService.instance;
  }
  
  // ===========================================================================
  // Configuration & Provider Management
  // ===========================================================================
  
  async initialize(config?: Partial<OpenClawConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    // Check Ollama availability
    await this.checkOllamaConnection();
    
    // Check Anthropic availability
    this.checkAnthropicConnection();
    
    logger.info("OpenClaw Data Pipeline initialized", {
      ollama: this.ollamaConnection?.available,
      anthropic: this.anthropicConnection?.available,
    });
  }
  
  private async checkOllamaConnection(): Promise<void> {
    const ollamaConfig = this.config.aiProviders.ollama;
    if (!ollamaConfig?.enabled) {
      this.ollamaConnection = null;
      return;
    }
    
    try {
      const baseURL = ollamaConfig.baseURL || "http://localhost:11434";
      const response = await fetch(`${baseURL}/api/tags`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        this.ollamaConnection = {
          type: "ollama",
          baseURL,
          model: ollamaConfig.model || "llama3.1:8b",
          available: true,
        };
        logger.info("Ollama connection established", { baseURL, model: this.ollamaConnection.model });
      } else {
        this.ollamaConnection = {
          type: "ollama",
          baseURL,
          model: ollamaConfig.model || "llama3.1:8b",
          available: false,
        };
      }
    } catch (error) {
      logger.warn("Ollama not available", { error: (error as Error).message });
      this.ollamaConnection = null;
    }
  }
  
  private checkAnthropicConnection(): void {
    const anthropicConfig = this.config.aiProviders.anthropic;
    if (!anthropicConfig?.enabled || !anthropicConfig.apiKey) {
      this.anthropicConnection = null;
      return;
    }
    
    this.anthropicConnection = {
      type: "anthropic",
      baseURL: "https://api.anthropic.com",
      apiKey: anthropicConfig.apiKey,
      model: anthropicConfig.model || "claude-sonnet-4-5",
      available: true,
    };
    logger.info("Anthropic connection configured", { model: this.anthropicConnection.model });
  }
  
  setAnthropicApiKey(apiKey: string): void {
    if (this.config.aiProviders.anthropic) {
      this.config.aiProviders.anthropic.apiKey = apiKey;
      this.config.aiProviders.anthropic.enabled = true;
    }
    this.checkAnthropicConnection();
  }
  
  getAvailableProviders(): string[] {
    const providers: string[] = [];
    if (this.ollamaConnection?.available) providers.push("ollama");
    if (this.anthropicConnection?.available) providers.push("anthropic");
    return providers;
  }
  
  // ===========================================================================
  // AI Communication
  // ===========================================================================
  
  /**
   * Send a chat request to AI (prefers local Ollama, falls back to Anthropic)
   */
  private async aiChat(
    prompt: string,
    options?: {
      preferLocal?: boolean;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<{ content: string; provider: string }> {
    const preferLocal = options?.preferLocal ?? true;
    
    // Try Ollama first if preferred and available
    if (preferLocal && this.ollamaConnection?.available) {
      try {
        const result = await this.chatWithOllama(prompt, options);
        return { content: result, provider: "ollama" };
      } catch (error) {
        logger.warn("Ollama chat failed, trying fallback", { error: (error as Error).message });
      }
    }
    
    // Try Anthropic as fallback
    if (this.anthropicConnection?.available) {
      try {
        const result = await this.chatWithAnthropic(prompt, options);
        return { content: result, provider: "anthropic" };
      } catch (error) {
        logger.error("Anthropic chat failed", { error: (error as Error).message });
        throw error;
      }
    }
    
    // If local is preferred but failed and no fallback, try Ollama again without preference
    if (this.ollamaConnection?.available) {
      const result = await this.chatWithOllama(prompt, options);
      return { content: result, provider: "ollama" };
    }
    
    throw new Error("No AI providers available");
  }
  
  private async chatWithOllama(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    if (!this.ollamaConnection) {
      throw new Error("Ollama not configured");
    }
    
    const messages: Array<{ role: string; content: string }> = [];
    if (options?.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }
    messages.push({ role: "user", content: prompt });
    
    const response = await fetch(`${this.ollamaConnection.baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.ollamaConnection.model,
        messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 2048,
        },
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.message?.content || "";
  }
  
  private async chatWithAnthropic(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    }
  ): Promise<string> {
    if (!this.anthropicConnection?.apiKey) {
      throw new Error("Anthropic not configured");
    }
    
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.anthropicConnection.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.anthropicConnection.model,
        max_tokens: options?.maxTokens ?? 2048,
        system: options?.systemPrompt,
        messages: [{ role: "user", content: prompt }],
        temperature: options?.temperature ?? 0.7,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic request failed: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    return data.content?.[0]?.text || "";
  }
  
  // ===========================================================================
  // AI-Enhanced Scraping
  // ===========================================================================
  
  /**
   * Scrape web content with optional AI-powered extraction
   */
  async scrape(config: OpenClawScrapingConfig): Promise<OpenClawScrapingResult[]> {
    const jobId = uuidv4();
    const mergedConfig = { ...DEFAULT_SCRAPING_CONFIG, ...config };
    
    const job: DataJob = {
      id: jobId,
      type: "scrape",
      status: "running",
      progress: 0,
      startedAt: Date.now(),
    };
    this.jobs.set(jobId, job);
    this.emit("job:started", job);
    
    const results: OpenClawScrapingResult[] = [];
    
    try {
      for (let i = 0; i < mergedConfig.urls.length; i++) {
        const url = mergedConfig.urls[i];
        job.progress = Math.round((i / mergedConfig.urls.length) * 100);
        this.emit("job:progress", { jobId, progress: job.progress });
        
        try {
          const result = await this.scrapeUrl(url, mergedConfig, jobId);
          results.push(result);
        } catch (error) {
          results.push({
            success: false,
            jobId,
            url,
            error: (error as Error).message,
          });
        }
        
        // Rate limiting
        if (mergedConfig.rateLimit?.delayBetweenRequests && i < mergedConfig.urls.length - 1) {
          await this.delay(mergedConfig.rateLimit.delayBetweenRequests);
        }
      }
      
      job.status = "completed";
      job.progress = 100;
      job.completedAt = Date.now();
      job.result = results;
      this.emit("job:completed", { jobId, results });
      
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
      this.emit("job:failed", { jobId, error: job.error });
    }
    
    return results;
  }
  
  private async scrapeUrl(
    url: string,
    config: OpenClawScrapingConfig,
    jobId: string
  ): Promise<OpenClawScrapingResult> {
    const startTime = Date.now();
    
    // Fetch the page content
    let rawContent: string;
    let contentType = "text/html";
    
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": "JoyCreate-OpenClaw/1.0 (AI Data Collection)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(30000),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      contentType = response.headers.get("content-type") || "text/html";
      rawContent = await response.text();
    } catch (error) {
      throw new Error(`Failed to fetch ${url}: ${(error as Error).message}`);
    }
    
    const fetchTime = Date.now() - startTime;
    
    // Extract content using selectors if provided
    let extractedContent = rawContent;
    let extractedTitle: string | undefined;
    let extractedImages: Array<{ url: string; altText?: string }> = [];
    
    // Basic HTML parsing for title and images
    const titleMatch = rawContent.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      extractedTitle = this.decodeHtmlEntities(titleMatch[1]);
    }
    
    // Extract images
    const imgMatches = rawContent.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?[^>]*>/gi);
    for (const match of imgMatches) {
      const imgUrl = this.resolveUrl(match[1], url);
      extractedImages.push({
        url: imgUrl,
        altText: match[2],
      });
    }
    
    // Strip HTML tags for text content
    const textContent = this.stripHtml(rawContent);
    
    // Apply content filters
    if (config.filters) {
      if (config.filters.minContentLength && textContent.length < config.filters.minContentLength) {
        return {
          success: false,
          jobId,
          url,
          error: "Content below minimum length",
        };
      }
      if (config.filters.maxContentLength && textContent.length > config.filters.maxContentLength) {
        extractedContent = textContent.slice(0, config.filters.maxContentLength);
      }
    }
    
    // AI-enhanced extraction if enabled
    let aiExtractedData: OpenClawScrapingResult["extractedData"];
    let aiProvider: string | undefined;
    let extractionTime: number | undefined;
    
    if (config.aiExtraction?.enabled) {
      const aiStartTime = Date.now();
      
      try {
        const aiResult = await this.performAIExtraction(
          textContent.slice(0, 15000), // Limit content for AI processing
          extractedTitle,
          config.aiExtraction,
          url
        );
        aiExtractedData = aiResult.data;
        aiProvider = aiResult.provider;
        extractionTime = Date.now() - aiStartTime;
      } catch (error) {
        logger.warn("AI extraction failed, using raw content", { error: (error as Error).message });
      }
    }
    
    // Format output
    let finalContent = textContent;
    if (config.output?.format === "markdown") {
      finalContent = this.convertToMarkdown(rawContent, url);
    } else if (config.output?.format === "html") {
      finalContent = rawContent;
    } else if (config.output?.format === "json") {
      finalContent = JSON.stringify({
        title: extractedTitle,
        content: textContent,
        url,
        extractedAt: new Date().toISOString(),
      });
    }
    
    return {
      success: true,
      jobId,
      url,
      rawContent: config.output?.format === "html" ? rawContent : undefined,
      extractedData: aiExtractedData || {
        title: extractedTitle,
        content: finalContent,
      },
      images: config.output?.extractImages ? extractedImages.map((img) => ({
        url: img.url,
        altText: img.altText,
      })) : undefined,
      aiProvider,
      stats: {
        fetchTimeMs: fetchTime,
        extractionTimeMs: extractionTime,
        contentLength: textContent.length,
      },
    };
  }
  
  private async performAIExtraction(
    content: string,
    title: string | undefined,
    config: NonNullable<OpenClawScrapingConfig["aiExtraction"]>,
    url: string
  ): Promise<{ data: OpenClawScrapingResult["extractedData"]; provider: string }> {
    const systemPrompt = `You are an expert web content extractor. Analyze the given web page content and extract structured information.
Your task is to:
1. Identify the main content and remove any navigation, ads, or boilerplate
2. Extract a concise summary (2-3 sentences)
3. Identify key entities (people, organizations, products, locations)
4. Determine the overall sentiment
5. Identify main topics/themes

${config.instructions ? `Additional instructions: ${config.instructions}` : ""}

Respond in JSON format with this structure:
{
  "title": "extracted or inferred title",
  "content": "cleaned main content",
  "summary": "2-3 sentence summary",
  "entities": [{"name": "entity name", "type": "person|organization|product|location|other", "value": "additional context"}],
  "sentiment": "positive|negative|neutral",
  "topics": ["topic1", "topic2"]
}`;

    const userPrompt = `URL: ${url}
${title ? `Page Title: ${title}` : ""}

Content to analyze:
${content}`;

    const { content: aiResponse, provider } = await this.aiChat(userPrompt, {
      preferLocal: config.preferLocal,
      systemPrompt,
      temperature: 0.3,
      maxTokens: 2000,
    });
    
    // Parse JSON response
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, aiResponse];
      const jsonStr = jsonMatch[1] || aiResponse;
      const parsed = JSON.parse(jsonStr.trim());
      
      return {
        data: {
          title: parsed.title,
          content: parsed.content,
          summary: parsed.summary,
          entities: parsed.entities,
          sentiment: parsed.sentiment,
          topics: parsed.topics,
        },
        provider,
      };
    } catch (error) {
      logger.warn("Failed to parse AI extraction response as JSON", { error: (error as Error).message });
      return {
        data: {
          content: aiResponse,
        },
        provider,
      };
    }
  }
  
  // ===========================================================================
  // AI-Enhanced Image Generation
  // ===========================================================================
  
  /**
   * Generate images with AI-enhanced prompts
   */
  async generateImage(config: OpenClawImageGenConfig): Promise<OpenClawImageGenResult> {
    const jobId = uuidv4();
    const mergedConfig = { ...DEFAULT_IMAGE_GEN_CONFIG, ...config };
    
    const job: DataJob = {
      id: jobId,
      type: "image-gen",
      status: "running",
      progress: 0,
      startedAt: Date.now(),
    };
    this.jobs.set(jobId, job);
    this.emit("job:started", job);
    
    let enhancedPrompt: string | undefined;
    let aiProvider: string | undefined;
    let promptEnhancementTime: number | undefined;
    
    try {
      // Enhance prompt with AI if enabled
      if (mergedConfig.aiPromptEnhancement?.enabled) {
        const enhanceStartTime = Date.now();
        const enhanceResult = await this.enhanceImagePrompt(
          mergedConfig.prompt,
          mergedConfig.aiPromptEnhancement
        );
        enhancedPrompt = enhanceResult.prompt;
        aiProvider = enhanceResult.provider;
        promptEnhancementTime = Date.now() - enhanceStartTime;
        
        job.progress = 20;
        this.emit("job:progress", { jobId, progress: job.progress });
      }
      
      // Use enhanced prompt or original
      const finalPrompt = enhancedPrompt || mergedConfig.prompt;
      
      // Generate image using the configured backend
      // This would integrate with the existing media_generation.ts service
      const generationResult = await this.executeImageGeneration(
        finalPrompt,
        mergedConfig,
        jobId
      );
      
      job.status = "completed";
      job.progress = 100;
      job.completedAt = Date.now();
      
      const result: OpenClawImageGenResult = {
        success: true,
        jobId,
        originalPrompt: mergedConfig.prompt,
        enhancedPrompt,
        images: generationResult.images,
        aiProvider,
        stats: {
          promptEnhancementTimeMs: promptEnhancementTime,
          generationTimeMs: Date.now() - (job.startedAt || 0) - (promptEnhancementTime || 0),
          model: mergedConfig.model || "stable-diffusion-xl",
        },
      };
      
      job.result = result;
      this.emit("job:completed", { jobId, result });
      
      return result;
      
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
      this.emit("job:failed", { jobId, error: job.error });
      
      return {
        success: false,
        jobId,
        originalPrompt: mergedConfig.prompt,
        enhancedPrompt,
        images: [],
        aiProvider,
        error: job.error,
      };
    }
  }
  
  private async enhanceImagePrompt(
    prompt: string,
    config: NonNullable<OpenClawImageGenConfig["aiPromptEnhancement"]>
  ): Promise<{ prompt: string; provider: string }> {
    const systemPrompt = `You are an expert at crafting prompts for AI image generation models like Stable Diffusion and DALL-E.
Your task is to enhance the user's prompt to produce higher quality, more detailed images.

Guidelines:
${config.expandPrompt ? "- Expand brief prompts with more descriptive details" : ""}
${config.addQualityTerms ? "- Add quality enhancing terms like 'highly detailed', '8k', 'professional', etc." : ""}
${config.style ? `- Apply this style: ${config.style}` : ""}
- Maintain the core concept and intention of the original prompt
- Use comma-separated descriptive phrases
- Keep the enhanced prompt under 200 words
- Focus on visual elements: lighting, composition, style, medium, mood

Respond with ONLY the enhanced prompt, no explanations.`;

    const userPrompt = `Enhance this image generation prompt: "${prompt}"`;

    const { content: enhancedPrompt, provider } = await this.aiChat(userPrompt, {
      preferLocal: config.preferLocal,
      systemPrompt,
      temperature: 0.7,
      maxTokens: 300,
    });
    
    return {
      prompt: enhancedPrompt.trim().replace(/^["']|["']$/g, ""),
      provider,
    };
  }
  
  private async executeImageGeneration(
    prompt: string,
    config: OpenClawImageGenConfig,
    jobId: string
  ): Promise<{ images: OpenClawImageGenResult["images"] }> {
    // This integrates with the existing MediaGenerationService
    // For now, return a placeholder - the actual integration would call the service
    
    logger.info("Executing image generation", {
      jobId,
      prompt: prompt.slice(0, 100),
      model: config.model,
      dimensions: `${config.width}x${config.height}`,
    });
    
    // Import and use the media generation service
    try {
      const { mediaGeneration } = await import("./media_generation");
      
      const imageJob = await mediaGeneration.generateImage({
        prompt,
        negativePrompt: config.negativePrompt,
        width: config.width,
        height: config.height,
        model: config.model,
        steps: config.steps,
        cfgScale: config.cfgScale,
        sampler: config.sampler,
        seed: config.seed,
        batchSize: config.batchSize,
      });
      
      // Wait for job completion (with timeout)
      const maxWaitTime = 300000; // 5 minutes
      const startWait = Date.now();
      
      while (imageJob.status !== "completed" && imageJob.status !== "failed") {
        if (Date.now() - startWait > maxWaitTime) {
          throw new Error("Image generation timeout");
        }
        await this.delay(1000);
        
        // Update progress
        this.emit("job:progress", { jobId, progress: 20 + (imageJob.progress || 0) * 0.8 });
      }
      
      if (imageJob.status === "failed") {
        throw new Error(imageJob.error || "Image generation failed");
      }
      
      // Convert outputs to our format
      type ImageOutput = { id?: string; path: string; metadata?: Record<string, unknown> };
      const images: OpenClawImageGenResult["images"] = (imageJob.outputs as ImageOutput[] || []).map((output: ImageOutput, index: number) => ({
        id: output.id || `${jobId}_${index}`,
        path: output.path,
        width: config.width || 1024,
        height: config.height || 1024,
        seed: (config.seed || 0) + index,
        metadata: output.metadata,
      }));
      
      return { images };
      
    } catch (error) {
      logger.error("Image generation failed", { error: (error as Error).message });
      
      // Return empty images array on failure
      return { images: [] };
    }
  }
  
  // ===========================================================================
  // Data Pipeline Orchestration
  // ===========================================================================
  
  /**
   * Run a data collection pipeline
   */
  async runPipeline(config: OpenClawDataPipelineConfig): Promise<OpenClawPipelineResult> {
    const pipelineId = uuidv4();
    const startTime = Date.now();
    
    const job: DataJob = {
      id: pipelineId,
      type: "pipeline",
      status: "running",
      progress: 0,
      startedAt: startTime,
    };
    this.jobs.set(pipelineId, job);
    this.emit("pipeline:started", { pipelineId, name: config.name });
    
    const stages: OpenClawPipelineResult["stages"] = [];
    const aiProvidersUsed: Set<string> = new Set();
    let currentData: unknown[] = [];
    
    try {
      // Stage 1: Data Collection
      const collectionStage = { name: "Data Collection", status: "success" as const, itemsIn: 0, itemsOut: 0, duration: 0 };
      const collectionStart = Date.now();
      
      for (const source of config.sources) {
        if (source.type === "scraping") {
          const scrapingConfig = source.config as OpenClawScrapingConfig;
          const results = await this.scrape(scrapingConfig);
          
          for (const result of results) {
            if (result.success && result.extractedData) {
              currentData.push(result.extractedData);
              if (result.aiProvider) aiProvidersUsed.add(result.aiProvider);
            }
          }
        }
        // Add more source types as needed
      }
      
      collectionStage.itemsIn = config.sources.length;
      collectionStage.itemsOut = currentData.length;
      collectionStage.duration = Date.now() - collectionStart;
      stages.push(collectionStage);
      
      job.progress = 30;
      this.emit("job:progress", { jobId: pipelineId, progress: job.progress });
      
      // Stage 2: Processing
      for (let i = 0; i < config.processing.length; i++) {
        const step = config.processing[i];
        const processingStage = {
          name: `Processing: ${step.type}`,
          status: "success" as const,
          itemsIn: currentData.length,
          itemsOut: 0,
          duration: 0,
        };
        const stepStart = Date.now();
        
        if (step.type === "ai-transform") {
          const transformed = await this.aiTransformData(currentData, step.config);
          currentData = transformed.data;
          if (transformed.provider) aiProvidersUsed.add(transformed.provider);
        } else if (step.type === "filter") {
          currentData = this.filterData(currentData, step.config);
        } else if (step.type === "dedupe") {
          currentData = this.dedupeData(currentData);
        }
        
        processingStage.itemsOut = currentData.length;
        processingStage.duration = Date.now() - stepStart;
        stages.push(processingStage);
        
        job.progress = 30 + Math.round(((i + 1) / config.processing.length) * 50);
        this.emit("job:progress", { jobId: pipelineId, progress: job.progress });
      }
      
      // Stage 3: Output
      const outputStage = { name: "Output", status: "success" as const, itemsIn: currentData.length, itemsOut: 0, duration: 0 };
      const outputStart = Date.now();
      
      if (config.output.type === "dataset" && config.output.config.datasetId) {
        // Store in dataset (would integrate with dataset service)
        outputStage.itemsOut = currentData.length;
        logger.info("Pipeline output to dataset", {
          datasetId: config.output.config.datasetId,
          itemCount: currentData.length,
        });
      } else if (config.output.type === "n8n" && config.output.config.n8nWorkflowId) {
        // Trigger n8n workflow
        await this.triggerN8nWorkflow(config.output.config.n8nWorkflowId, currentData);
        outputStage.itemsOut = currentData.length;
      }
      
      outputStage.duration = Date.now() - outputStart;
      stages.push(outputStage);
      
      job.status = "completed";
      job.progress = 100;
      job.completedAt = Date.now();
      
      const result: OpenClawPipelineResult = {
        success: true,
        pipelineId,
        pipelineName: config.name,
        itemsCollected: stages[0]?.itemsOut || 0,
        itemsProcessed: currentData.length,
        itemsOutput: currentData.length,
        stages,
        aiProvidersUsed: Array.from(aiProvidersUsed),
        totalDuration: Date.now() - startTime,
      };
      
      job.result = result;
      this.emit("pipeline:completed", { pipelineId, result });
      
      return result;
      
    } catch (error) {
      job.status = "failed";
      job.error = (error as Error).message;
      
      const result: OpenClawPipelineResult = {
        success: false,
        pipelineId,
        pipelineName: config.name,
        itemsCollected: 0,
        itemsProcessed: 0,
        itemsOutput: 0,
        stages,
        aiProvidersUsed: Array.from(aiProvidersUsed),
        totalDuration: Date.now() - startTime,
        error: job.error,
      };
      
      this.emit("pipeline:failed", { pipelineId, error: job.error });
      return result;
    }
  }
  
  private async aiTransformData(
    data: unknown[],
    config: { preferLocal?: boolean; instructions?: string }
  ): Promise<{ data: unknown[]; provider?: string }> {
    if (data.length === 0) return { data: [] };
    
    const systemPrompt = `You are a data transformation assistant. Transform the given data according to the instructions.
${config.instructions || "Clean and structure the data appropriately."}

Respond with a JSON array of transformed items.`;

    // Process in batches
    const batchSize = 10;
    const transformed: unknown[] = [];
    let lastProvider: string | undefined;
    
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        const { content, provider } = await this.aiChat(
          JSON.stringify(batch, null, 2),
          {
            preferLocal: config.preferLocal ?? true,
            systemPrompt,
            temperature: 0.3,
          }
        );
        lastProvider = provider;
        
        // Parse response
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
        const jsonStr = jsonMatch[1] || content;
        const parsed = JSON.parse(jsonStr.trim());
        
        if (Array.isArray(parsed)) {
          transformed.push(...parsed);
        } else {
          transformed.push(parsed);
        }
      } catch (error) {
        // On error, keep original data
        transformed.push(...batch);
        logger.warn("AI transform failed for batch, keeping original", { error: (error as Error).message });
      }
    }
    
    return { data: transformed, provider: lastProvider };
  }
  
  private filterData(data: unknown[], config: { conditions?: Record<string, unknown> }): unknown[] {
    if (!config.conditions) return data;
    
    return data.filter((item) => {
      if (typeof item !== "object" || item === null) return true;
      
      for (const [key, value] of Object.entries(config.conditions || {})) {
        if ((item as Record<string, unknown>)[key] !== value) {
          return false;
        }
      }
      return true;
    });
  }
  
  private dedupeData(data: unknown[]): unknown[] {
    const seen = new Set<string>();
    return data.filter((item) => {
      const hash = JSON.stringify(item);
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
  }
  
  private async triggerN8nWorkflow(workflowId: string, data: unknown[]): Promise<void> {
    try {
      const webhookUrl = `http://localhost:5679/webhook/${workflowId}`;
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, source: "OpenClaw-pipeline" }),
      });
    } catch (error) {
      logger.warn("Failed to trigger n8n workflow", { workflowId, error: (error as Error).message });
    }
  }
  
  // ===========================================================================
  // Unified Data Request Handler
  // ===========================================================================
  
  /**
   * Handle unified data requests through OpenClaw
   */
  async handleDataRequest(request: OpenClawDataRequest): Promise<OpenClawDataResponse> {
    const response: OpenClawDataResponse = {
      requestId: request.requestId,
      type: request.type,
      success: false,
    };
    
    try {
      switch (request.type) {
        case "scrape":
          if (request.scrapingConfig) {
            const results = await this.scrape(request.scrapingConfig);
            response.scrapingResult = results[0]; // Return first result for single requests
            response.success = results.some((r) => r.success);
            response.aiProvider = results[0]?.aiProvider;
          }
          break;
          
        case "generate-image":
          if (request.imageGenConfig) {
            response.imageGenResult = await this.generateImage(request.imageGenConfig);
            response.success = response.imageGenResult.success;
            response.aiProvider = response.imageGenResult.aiProvider;
          }
          break;
          
        case "run-pipeline":
          if (request.pipelineConfig) {
            response.pipelineResult = await this.runPipeline(request.pipelineConfig);
            response.success = response.pipelineResult.success;
            response.aiProvider = response.pipelineResult.aiProvidersUsed[0];
          }
          break;
          
        default:
          response.error = `Unknown request type: ${request.type}`;
      }
    } catch (error) {
      response.error = (error as Error).message;
    }
    
    return response;
  }
  
  // ===========================================================================
  // Job Management
  // ===========================================================================
  
  getJob(jobId: string): DataJob | undefined {
    return this.jobs.get(jobId);
  }
  
  getActiveJobs(): DataJob[] {
    return Array.from(this.jobs.values()).filter((j) => j.status === "running");
  }
  
  async cancelJob(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "running") return false;
    
    job.status = "cancelled";
    this.emit("job:cancelled", { jobId });
    return true;
  }
  
  // ===========================================================================
  // Utility Functions
  // ===========================================================================
  
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  
  private stripHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  
  private resolveUrl(url: string, base: string): string {
    try {
      return new URL(url, base).href;
    } catch {
      return url;
    }
  }
  
  private convertToMarkdown(html: string, url: string): string {
    // Basic HTML to Markdown conversion
    let md = html;
    
    // Remove scripts and styles
    md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
    
    // Headers
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
    md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
    
    // Paragraphs
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
    
    // Links
    md = md.replace(/<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)");
    
    // Bold and italic
    md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
    md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
    md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
    md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
    
    // Lists
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");
    md = md.replace(/<\/?[uo]l[^>]*>/gi, "\n");
    
    // Remove remaining HTML tags
    md = md.replace(/<[^>]+>/g, "");
    
    // Clean up whitespace
    md = md.replace(/\n{3,}/g, "\n\n");
    md = md.trim();
    
    // Add source
    md = `Source: ${url}\n\n---\n\n${md}`;
    
    return md;
  }
}

// Export singleton instance getter
export const getOpenClawDataPipeline = () => OpenClawDataPipelineService.getInstance();
