/**
 * Quality Analysis Handlers
 * Automated quality assessment and content analysis for datasets
 * 
 * Features:
 * - Image quality: blur detection, aesthetic scoring, NSFW detection
 * - Text quality: perplexity, readability, language detection
 * - Audio quality: SNR estimation, silence detection
 * - Duplicate detection: perceptual hashing, similarity
 * - Content classification
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, and, sql, count, inArray } from "drizzle-orm";
import {
  datasetItems,
  contentBlobs,
  type QualitySignals,
} from "@/db/schema";

const logger = log.scope("quality_analysis");

// ============================================================================
// Types
// ============================================================================

interface ImageQualityResult {
  blurScore: number;           // 0-1, lower is sharper
  brightnessScore: number;     // 0-1, 0.5 is ideal
  contrastScore: number;       // 0-1, higher is better
  aestheticScore?: number;     // 0-1, requires ML model
  nsfwScore?: number;          // 0-1, requires ML model
  resolution: { width: number; height: number };
  aspectRatio: number;
  colorfulness: number;        // 0-1
  hasText?: boolean;
}

interface TextQualityResult {
  wordCount: number;
  sentenceCount: number;
  avgWordLength: number;
  avgSentenceLength: number;
  readabilityScore: number;    // Flesch-Kincaid
  perplexity?: number;         // Requires LM
  languageCode?: string;
  languageConfidence?: number;
  hasProfanity: boolean;
  hasUrls: boolean;
  hasEmails: boolean;
  uniqueWords: number;
  lexicalDiversity: number;    // Unique words / total words
}

interface AudioQualityResult {
  duration: number;
  sampleRate: number;
  channels: number;
  snrDb?: number;              // Signal-to-noise ratio
  silencePercentage: number;
  clippingPercentage: number;
  averageLoudness: number;
  peakLoudness: number;
}

interface DuplicateResult {
  hash: string;
  perceptualHash?: string;
  similarItems: Array<{
    itemId: string;
    similarity: number;
  }>;
  isDuplicate: boolean;
}

interface BatchAnalysisResult {
  itemId: string;
  success: boolean;
  signals?: QualitySignals;
  error?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getContentStoreDir(): string {
  return path.join(app.getPath("userData"), "content-store");
}

/**
 * Calculate Laplacian variance for blur detection
 * Higher variance = sharper image
 */
function calculateBlurScore(imageData: Buffer): number {
  // Simplified blur detection based on edge content
  // In production, use actual Laplacian variance with Sharp or similar
  
  // Calculate a simple metric based on byte variation
  let sum = 0;
  let sumSquared = 0;
  const samples = Math.min(imageData.length, 10000);
  
  for (let i = 0; i < samples; i++) {
    const byte = imageData[i];
    sum += byte;
    sumSquared += byte * byte;
  }
  
  const mean = sum / samples;
  const variance = (sumSquared / samples) - (mean * mean);
  
  // Normalize to 0-1 (lower = blurrier)
  const normalized = Math.min(variance / 5000, 1);
  
  // Invert so higher = blurrier (matching typical blur score semantics)
  return 1 - normalized;
}

/**
 * Calculate brightness score
 */
function calculateBrightness(imageData: Buffer): number {
  let sum = 0;
  const samples = Math.min(imageData.length, 10000);
  
  for (let i = 0; i < samples; i++) {
    sum += imageData[i];
  }
  
  const avgBrightness = sum / samples / 255;
  
  // Score based on distance from ideal (0.5)
  return 1 - Math.abs(avgBrightness - 0.5) * 2;
}

/**
 * Compute perceptual hash for images
 * Simplified version using average hash algorithm
 */
function computePerceptualHash(imageData: Buffer): string {
  // Sample the image data in a grid pattern
  const gridSize = 8;
  const samplesPerCell = Math.floor(imageData.length / (gridSize * gridSize));
  const grid: number[] = [];
  
  for (let i = 0; i < gridSize * gridSize; i++) {
    const startIdx = i * samplesPerCell;
    const endIdx = Math.min(startIdx + samplesPerCell, imageData.length);
    
    let sum = 0;
    for (let j = startIdx; j < endIdx; j++) {
      sum += imageData[j];
    }
    grid.push(sum / (endIdx - startIdx));
  }
  
  // Compute average
  const avg = grid.reduce((a, b) => a + b, 0) / grid.length;
  
  // Generate hash based on whether each cell is above/below average
  let hash = "";
  for (const val of grid) {
    hash += val >= avg ? "1" : "0";
  }
  
  // Convert binary to hex
  let hexHash = "";
  for (let i = 0; i < hash.length; i += 4) {
    hexHash += parseInt(hash.substr(i, 4), 2).toString(16);
  }
  
  return hexHash;
}

/**
 * Calculate Hamming distance between two hashes
 */
function hammingDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 1;
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const bits1 = parseInt(hash1[i], 16);
    const bits2 = parseInt(hash2[i], 16);
    const xor = bits1 ^ bits2;
    
    // Count set bits in XOR result
    let count = 0;
    let n = xor;
    while (n) {
      count += n & 1;
      n >>= 1;
    }
    distance += count;
  }
  
  // Normalize by total bits
  return distance / (hash1.length * 4);
}

/**
 * Analyze text quality
 */
function analyzeText(text: string): TextQualityResult {
  // Basic text analysis
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, 1);
  
  // Average lengths
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / Math.max(wordCount, 1);
  const avgSentenceLength = wordCount / sentenceCount;
  
  // Flesch-Kincaid Grade Level (simplified)
  // FK = 0.39 * (words/sentences) + 11.8 * (syllables/words) - 15.59
  // Simplified: estimate syllables as vowel clusters
  const syllableCount = (text.match(/[aeiouy]+/gi) || []).length;
  const syllablesPerWord = syllableCount / Math.max(wordCount, 1);
  const readabilityScore = Math.min(1, Math.max(0, 
    1 - (0.39 * avgSentenceLength + 11.8 * syllablesPerWord - 15.59) / 20
  ));
  
  // Unique words and lexical diversity
  const uniqueWords = new Set(words.map(w => w.toLowerCase())).size;
  const lexicalDiversity = uniqueWords / Math.max(wordCount, 1);
  
  // Content checks
  const hasUrls = /https?:\/\/\S+/.test(text);
  const hasEmails = /\S+@\S+\.\S+/.test(text);
  
  // Simple profanity check (would use a proper list in production)
  const profanityPatterns = /\b(damn|hell|crap)\b/i;
  const hasProfanity = profanityPatterns.test(text);
  
  // Language detection (simplified - check common words)
  let languageCode = "en";
  let languageConfidence = 0.5;
  
  const englishWords = ["the", "a", "is", "are", "and", "or", "to", "of"];
  const spanishWords = ["el", "la", "es", "son", "y", "o", "de", "que"];
  const frenchWords = ["le", "la", "est", "sont", "et", "ou", "de", "que"];
  
  const lowerText = text.toLowerCase();
  const enCount = englishWords.filter(w => lowerText.includes(` ${w} `)).length;
  const esCount = spanishWords.filter(w => lowerText.includes(` ${w} `)).length;
  const frCount = frenchWords.filter(w => lowerText.includes(` ${w} `)).length;
  
  if (esCount > enCount && esCount > frCount) {
    languageCode = "es";
    languageConfidence = esCount / 8;
  } else if (frCount > enCount && frCount > esCount) {
    languageCode = "fr";
    languageConfidence = frCount / 8;
  } else {
    languageCode = "en";
    languageConfidence = enCount / 8;
  }
  
  return {
    wordCount,
    sentenceCount,
    avgWordLength,
    avgSentenceLength,
    readabilityScore,
    languageCode,
    languageConfidence,
    hasProfanity,
    hasUrls,
    hasEmails,
    uniqueWords,
    lexicalDiversity,
  };
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerQualityAnalysisHandlers() {
  logger.info("Registering Quality Analysis handlers");

  // ========== Image Quality ==========

  /**
   * Analyze image quality
   */
  ipcMain.handle("quality:analyze-image", async (_event, args: {
    itemId?: string;
    filePath?: string;
    contentHash?: string;
  }) => {
    try {
      let imageData: Buffer;
      
      if (args.filePath) {
        imageData = await fs.readFile(args.filePath);
      } else if (args.contentHash) {
        const storeDir = getContentStoreDir();
        const prefix = args.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, args.contentHash);
        imageData = await fs.readFile(filePath);
      } else if (args.itemId) {
        const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, args.itemId));
        if (!item) throw new Error("Item not found");
        
        const storeDir = getContentStoreDir();
        const prefix = item.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, item.contentHash);
        imageData = await fs.readFile(filePath);
      } else {
        throw new Error("Must provide itemId, filePath, or contentHash");
      }
      
      // Calculate quality metrics
      const blurScore = calculateBlurScore(imageData);
      const brightnessScore = calculateBrightness(imageData);
      
      // Estimate contrast from byte distribution
      const histogram = new Array(256).fill(0);
      const samples = Math.min(imageData.length, 10000);
      for (let i = 0; i < samples; i++) {
        histogram[imageData[i]]++;
      }
      
      // Find min/max with significant values
      let minVal = 0, maxVal = 255;
      const threshold = samples * 0.001;
      for (let i = 0; i < 256; i++) {
        if (histogram[i] > threshold) { minVal = i; break; }
      }
      for (let i = 255; i >= 0; i--) {
        if (histogram[i] > threshold) { maxVal = i; break; }
      }
      const contrastScore = (maxVal - minVal) / 255;
      
      // Color analysis (simplified - would need proper RGB analysis)
      const colorfulness = Math.min(1, contrastScore * 1.2);
      
      const result: ImageQualityResult = {
        blurScore,
        brightnessScore,
        contrastScore,
        colorfulness,
        resolution: { width: 0, height: 0 }, // Would need image parsing
        aspectRatio: 1,
      };
      
      // Update item if itemId provided
      if (args.itemId) {
        const signals: Partial<QualitySignals> = {
          blurScore: result.blurScore,
          customSignals: {
            brightnessScore: result.brightnessScore,
            contrastScore: result.contrastScore,
          },
        };
        
        await db.update(datasetItems)
          .set({ 
            qualitySignalsJson: sql`json_patch(COALESCE(${datasetItems.qualitySignalsJson}, '{}'), ${JSON.stringify(signals)})`,
            updatedAt: new Date(),
          })
          .where(eq(datasetItems.id, args.itemId));
      }
      
      return { success: true, quality: result };
    } catch (error) {
      logger.error("Image quality analysis failed:", error);
      throw error;
    }
  });

  /**
   * Compute perceptual hash for image
   */
  ipcMain.handle("quality:compute-phash", async (_event, args: {
    itemId?: string;
    filePath?: string;
    contentHash?: string;
  }) => {
    try {
      let imageData: Buffer;
      
      if (args.filePath) {
        imageData = await fs.readFile(args.filePath);
      } else if (args.contentHash) {
        const storeDir = getContentStoreDir();
        const prefix = args.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, args.contentHash);
        imageData = await fs.readFile(filePath);
      } else if (args.itemId) {
        const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, args.itemId));
        if (!item) throw new Error("Item not found");
        
        const storeDir = getContentStoreDir();
        const prefix = item.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, item.contentHash);
        imageData = await fs.readFile(filePath);
      } else {
        throw new Error("Must provide itemId, filePath, or contentHash");
      }
      
      const pHash = computePerceptualHash(imageData);
      
      // Update item if itemId provided
      if (args.itemId) {
        await db.update(datasetItems)
          .set({ 
            qualitySignalsJson: sql`json_patch(COALESCE(${datasetItems.qualitySignalsJson}, '{}'), ${JSON.stringify({ perceptualHash: pHash })})`,
            updatedAt: new Date(),
          })
          .where(eq(datasetItems.id, args.itemId));
      }
      
      return { success: true, perceptualHash: pHash };
    } catch (error) {
      logger.error("Perceptual hash computation failed:", error);
      throw error;
    }
  });

  // ========== Text Quality ==========

  /**
   * Analyze text quality
   */
  ipcMain.handle("quality:analyze-text", async (_event, args: {
    itemId?: string;
    text?: string;
    contentHash?: string;
  }) => {
    try {
      let text: string;
      
      if (args.text) {
        text = args.text;
      } else if (args.contentHash) {
        const storeDir = getContentStoreDir();
        const prefix = args.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, args.contentHash);
        text = await fs.readFile(filePath, "utf-8");
      } else if (args.itemId) {
        const [item] = await db.select().from(datasetItems).where(eq(datasetItems.id, args.itemId));
        if (!item) throw new Error("Item not found");
        
        const storeDir = getContentStoreDir();
        const prefix = item.contentHash.substring(0, 2);
        const filePath = path.join(storeDir, prefix, item.contentHash);
        text = await fs.readFile(filePath, "utf-8");
      } else {
        throw new Error("Must provide itemId, text, or contentHash");
      }
      
      const quality = analyzeText(text);
      
      // Update item if itemId provided
      if (args.itemId) {
        const signals: Partial<QualitySignals> = {
          readabilityScore: quality.readabilityScore,
          customSignals: {
            wordCount: quality.wordCount,
            languageCode: quality.languageCode ? 1 : 0, // Convert to number for customSignals
            lexicalDiversity: quality.lexicalDiversity,
          },
        };
        
        await db.update(datasetItems)
          .set({ 
            qualitySignalsJson: sql`json_patch(COALESCE(${datasetItems.qualitySignalsJson}, '{}'), ${JSON.stringify(signals)})`,
            updatedAt: new Date(),
          })
          .where(eq(datasetItems.id, args.itemId));
      }
      
      return { success: true, quality };
    } catch (error) {
      logger.error("Text quality analysis failed:", error);
      throw error;
    }
  });

  // ========== Duplicate Detection ==========

  /**
   * Find duplicates in dataset using content hash
   */
  ipcMain.handle("quality:find-exact-duplicates", async (_event, datasetId: string) => {
    try {
      const items = await db.select({
        id: datasetItems.id,
        contentHash: datasetItems.contentHash,
        sourcePath: datasetItems.sourcePath,
      })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      // Group by hash
      const hashGroups: Map<string, string[]> = new Map();
      
      for (const item of items) {
        if (!hashGroups.has(item.contentHash)) {
          hashGroups.set(item.contentHash, []);
        }
        hashGroups.get(item.contentHash)!.push(item.id);
      }
      
      // Find groups with duplicates
      const duplicates: Array<{
        hash: string;
        itemIds: string[];
        count: number;
      }> = [];
      
      for (const [hash, itemIds] of hashGroups) {
        if (itemIds.length > 1) {
          duplicates.push({ hash, itemIds, count: itemIds.length });
        }
      }
      
      return {
        success: true,
        totalItems: items.length,
        uniqueItems: hashGroups.size,
        duplicateGroups: duplicates.length,
        duplicateItems: duplicates.reduce((sum, d) => sum + d.count - 1, 0),
        duplicates,
      };
    } catch (error) {
      logger.error("Find exact duplicates failed:", error);
      throw error;
    }
  });

  /**
   * Find similar images using perceptual hash
   */
  ipcMain.handle("quality:find-similar-images", async (_event, args: {
    datasetId: string;
    threshold?: number;  // 0-1, lower = more similar required
  }) => {
    try {
      const { datasetId, threshold = 0.1 } = args;
      
      // Get all image items with perceptual hashes
      const items = await db.select({
        id: datasetItems.id,
        contentHash: datasetItems.contentHash,
        qualitySignals: datasetItems.qualitySignalsJson,
      })
        .from(datasetItems)
        .where(
          and(
            eq(datasetItems.datasetId, datasetId),
            eq(datasetItems.modality, "image")
          )
        );
      
      // Compute perceptual hashes for items that don't have them
      const itemsWithHash: Array<{ id: string; pHash: string }> = [];
      
      for (const item of items) {
        let pHash = (item.qualitySignals as any)?.perceptualHash;
        
        if (!pHash) {
          // Compute hash
          try {
            const storeDir = getContentStoreDir();
            const prefix = item.contentHash.substring(0, 2);
            const filePath = path.join(storeDir, prefix, item.contentHash);
            const imageData = await fs.readFile(filePath);
            pHash = computePerceptualHash(imageData);
            
            // Store it
            await db.update(datasetItems)
              .set({ 
                qualitySignalsJson: sql`json_patch(COALESCE(${datasetItems.qualitySignalsJson}, '{}'), ${JSON.stringify({ perceptualHash: pHash })})`,
              })
              .where(eq(datasetItems.id, item.id));
          } catch {
            continue;
          }
        }
        
        itemsWithHash.push({ id: item.id, pHash });
      }
      
      // Find similar pairs
      const similarGroups: Array<{
        items: string[];
        similarity: number;
      }> = [];
      
      const processed: Set<string> = new Set();
      
      for (let i = 0; i < itemsWithHash.length; i++) {
        if (processed.has(itemsWithHash[i].id)) continue;
        
        const group: string[] = [itemsWithHash[i].id];
        let maxSimilarity = 0;
        
        for (let j = i + 1; j < itemsWithHash.length; j++) {
          if (processed.has(itemsWithHash[j].id)) continue;
          
          const distance = hammingDistance(itemsWithHash[i].pHash, itemsWithHash[j].pHash);
          const similarity = 1 - distance;
          
          if (distance <= threshold) {
            group.push(itemsWithHash[j].id);
            processed.add(itemsWithHash[j].id);
            maxSimilarity = Math.max(maxSimilarity, similarity);
          }
        }
        
        if (group.length > 1) {
          processed.add(itemsWithHash[i].id);
          similarGroups.push({ items: group, similarity: maxSimilarity });
        }
      }
      
      return {
        success: true,
        totalImages: itemsWithHash.length,
        similarGroups: similarGroups.length,
        groups: similarGroups,
      };
    } catch (error) {
      logger.error("Find similar images failed:", error);
      throw error;
    }
  });

  // ========== Batch Analysis ==========

  /**
   * Analyze quality for all items in dataset
   */
  ipcMain.handle("quality:batch-analyze", async (event, args: {
    datasetId: string;
    types?: Array<"blur" | "text" | "phash" | "all">;
    onlyUnanalyzed?: boolean;
  }) => {
    try {
      const { datasetId, types = ["all"], onlyUnanalyzed = true } = args;
      
      let items = await db.select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      if (onlyUnanalyzed) {
        items = items.filter(item => !item.qualitySignalsJson);
      }
      
      const results: BatchAnalysisResult[] = [];
      const analyzeAll = types.includes("all");
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        try {
          const signals: Partial<QualitySignals> = {};
          const customSignals: Record<string, number> = {};
          
          if (item.modality === "image" && (analyzeAll || types.includes("blur"))) {
            const storeDir = getContentStoreDir();
            const prefix = item.contentHash.substring(0, 2);
            const filePath = path.join(storeDir, prefix, item.contentHash);
            
            try {
              const imageData = await fs.readFile(filePath);
              signals.blurScore = calculateBlurScore(imageData);
              customSignals.brightnessScore = calculateBrightness(imageData);
              
              if (analyzeAll || types.includes("phash")) {
                customSignals.perceptualHashLength = computePerceptualHash(imageData).length;
              }
            } catch {
              // File might not exist
            }
          } else if (item.modality === "text" && (analyzeAll || types.includes("text"))) {
            const storeDir = getContentStoreDir();
            const prefix = item.contentHash.substring(0, 2);
            const filePath = path.join(storeDir, prefix, item.contentHash);
            
            try {
              const text = await fs.readFile(filePath, "utf-8");
              const quality = analyzeText(text);
              customSignals.wordCount = quality.wordCount;
              signals.readabilityScore = quality.readabilityScore;
              customSignals.lexicalDiversity = quality.lexicalDiversity;
            } catch {
              // File might not exist
            }
          }
          
          if (Object.keys(customSignals).length > 0) {
            signals.customSignals = customSignals;
          }
          
          if (Object.keys(signals).length > 0) {
            await db.update(datasetItems)
              .set({ 
                qualitySignalsJson: signals as QualitySignals,
                updatedAt: new Date(),
              })
              .where(eq(datasetItems.id, item.id));
          }
          
          results.push({
            itemId: item.id,
            success: true,
            signals: signals as QualitySignals,
          });
        } catch (error) {
          results.push({
            itemId: item.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        // Progress update
        if ((i + 1) % 10 === 0 || i === items.length - 1) {
          event.sender.send("quality:batch-progress", {
            current: i + 1,
            total: items.length,
            succeeded: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
          });
        }
      }
      
      return {
        success: true,
        total: items.length,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        results,
      };
    } catch (error) {
      logger.error("Batch analysis failed:", error);
      throw error;
    }
  });

  // ========== Quality Statistics ==========

  /**
   * Get quality statistics for dataset
   */
  ipcMain.handle("quality:get-statistics", async (_event, datasetId: string) => {
    try {
      const items = await db.select({
        id: datasetItems.id,
        modality: datasetItems.modality,
        qualitySignals: datasetItems.qualitySignalsJson,
      })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      const stats = {
        total: items.length,
        analyzed: 0,
        unanalyzed: 0,
        byModality: {} as Record<string, {
          total: number;
          analyzed: number;
          avgBlurScore?: number;
          avgReadability?: number;
        }>,
        quality: {
          avgBlurScore: 0,
          avgBrightness: 0,
          avgReadability: 0,
          blurScores: [] as number[],
          readabilityScores: [] as number[],
        },
      };
      
      for (const item of items) {
        const hasSignals = item.qualitySignals && Object.keys(item.qualitySignals).length > 0;
        
        if (hasSignals) {
          stats.analyzed++;
        } else {
          stats.unanalyzed++;
        }
        
        // By modality
        if (!stats.byModality[item.modality]) {
          stats.byModality[item.modality] = { total: 0, analyzed: 0 };
        }
        stats.byModality[item.modality].total++;
        
        if (hasSignals) {
          stats.byModality[item.modality].analyzed++;
          
          const signals = item.qualitySignals as any;
          
          if (signals.blurScore !== undefined) {
            stats.quality.blurScores.push(signals.blurScore);
          }
          if (signals.brightnessScore !== undefined) {
            stats.quality.avgBrightness += signals.brightnessScore;
          }
          if (signals.readabilityScore !== undefined) {
            stats.quality.readabilityScores.push(signals.readabilityScore);
          }
        }
      }
      
      // Calculate averages
      if (stats.quality.blurScores.length > 0) {
        stats.quality.avgBlurScore = stats.quality.blurScores.reduce((a, b) => a + b, 0) / stats.quality.blurScores.length;
      }
      if (stats.quality.readabilityScores.length > 0) {
        stats.quality.avgReadability = stats.quality.readabilityScores.reduce((a, b) => a + b, 0) / stats.quality.readabilityScores.length;
      }
      if (stats.analyzed > 0) {
        stats.quality.avgBrightness /= stats.analyzed;
      }
      
      return { success: true, statistics: stats };
    } catch (error) {
      logger.error("Get quality statistics failed:", error);
      throw error;
    }
  });

  // ========== Quality Filtering ==========

  /**
   * Filter items by quality thresholds
   */
  ipcMain.handle("quality:filter-items", async (_event, args: {
    datasetId: string;
    thresholds: {
      maxBlurScore?: number;
      minBrightness?: number;
      maxBrightness?: number;
      minReadability?: number;
      minWordCount?: number;
      maxWordCount?: number;
    };
    action?: "list" | "tag" | "move_to_split";
    targetSplit?: string;
    tag?: string;
  }) => {
    try {
      const { datasetId, thresholds, action = "list", targetSplit, tag } = args;
      
      const items = await db.select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));
      
      const matchingItems: string[] = [];
      
      for (const item of items) {
        if (!item.qualitySignalsJson) continue;
        
        const signals = item.qualitySignalsJson as any;
        let matches = true;
        
        if (thresholds.maxBlurScore !== undefined && signals.blurScore > thresholds.maxBlurScore) {
          matches = false;
        }
        if (thresholds.minBrightness !== undefined && signals.brightnessScore < thresholds.minBrightness) {
          matches = false;
        }
        if (thresholds.maxBrightness !== undefined && signals.brightnessScore > thresholds.maxBrightness) {
          matches = false;
        }
        if (thresholds.minReadability !== undefined && signals.readabilityScore < thresholds.minReadability) {
          matches = false;
        }
        if (thresholds.minWordCount !== undefined && signals.wordCount < thresholds.minWordCount) {
          matches = false;
        }
        if (thresholds.maxWordCount !== undefined && signals.wordCount > thresholds.maxWordCount) {
          matches = false;
        }
        
        if (matches) {
          matchingItems.push(item.id);
        }
      }
      
      // Apply action
      if (action === "move_to_split" && targetSplit && matchingItems.length > 0) {
        await db.update(datasetItems)
          .set({ split: targetSplit as any, updatedAt: new Date() })
          .where(inArray(datasetItems.id, matchingItems));
      } else if (action === "tag" && tag && matchingItems.length > 0) {
        for (const itemId of matchingItems) {
          await db.update(datasetItems)
            .set({ 
              labelsJson: sql`json_patch(COALESCE(${datasetItems.labelsJson}, '{}'), ${JSON.stringify({ qualityTag: tag })})`,
              updatedAt: new Date(),
            })
            .where(eq(datasetItems.id, itemId));
        }
      }
      
      return {
        success: true,
        totalItems: items.length,
        matchingItems: matchingItems.length,
        itemIds: matchingItems,
        action,
      };
    } catch (error) {
      logger.error("Quality filtering failed:", error);
      throw error;
    }
  });

  logger.info("Quality Analysis handlers registered");
}
