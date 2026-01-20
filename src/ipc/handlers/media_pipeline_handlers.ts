/**
 * Media Pipeline Handlers
 * Image, audio, and video processing for dataset management
 * 
 * Features:
 * - Image: resize, crop, format conversion, metadata extraction
 * - Audio: transcription, format conversion, waveform extraction
 * - Video: frame extraction, scene detection, thumbnail generation
 * - Common: metadata extraction, format detection
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { exec, spawn } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const logger = log.scope("media_pipeline");

// ============================================================================
// Types
// ============================================================================

interface MediaInfo {
  type: "image" | "audio" | "video" | "unknown";
  mimeType: string;
  size: number;
  // Image specific
  width?: number;
  height?: number;
  colorSpace?: string;
  hasAlpha?: boolean;
  // Audio/Video specific
  duration?: number;
  bitrate?: number;
  codec?: string;
  // Audio specific
  sampleRate?: number;
  channels?: number;
  // Video specific
  frameRate?: number;
  totalFrames?: number;
  // Metadata
  metadata?: Record<string, any>;
}

interface ImageProcessOptions {
  resize?: { width: number; height: number; mode: "fit" | "fill" | "crop" };
  crop?: { x: number; y: number; width: number; height: number };
  format?: "png" | "jpeg" | "webp" | "gif";
  quality?: number;
  stripMetadata?: boolean;
  grayscale?: boolean;
  blur?: number;
  rotate?: number;
}

interface AudioProcessOptions {
  format?: "mp3" | "wav" | "ogg" | "flac";
  sampleRate?: number;
  channels?: number;
  bitrate?: number;
  trim?: { start: number; end: number };
  normalize?: boolean;
}

interface VideoProcessOptions {
  format?: "mp4" | "webm" | "gif";
  resolution?: { width: number; height: number };
  frameRate?: number;
  trim?: { start: number; end: number };
  extractAudio?: boolean;
  removeAudio?: boolean;
}

interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
    confidence?: number;
  }>;
  language?: string;
  duration?: number;
}

interface FrameExtractionOptions {
  interval?: number;  // Extract frame every N seconds
  count?: number;     // Extract N frames total
  timestamps?: number[]; // Extract frames at specific timestamps
  format?: "png" | "jpeg";
  quality?: number;
}

interface ThumbnailOptions {
  width: number;
  height: number;
  timestamp?: number;  // For video, specific timestamp
  format?: "png" | "jpeg" | "webp";
  quality?: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getTempDir(): string {
  return path.join(app.getPath("temp"), "joycreate-media");
}

async function ensureTempDir(): Promise<string> {
  const tempDir = getTempDir();
  await fs.ensureDir(tempDir);
  return tempDir;
}

function getExtension(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/ogg": ".ogg",
    "audio/flac": ".flac",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };
  return extensions[mimeType] || "";
}

/**
 * Check if FFmpeg is available
 */
async function checkFFmpeg(): Promise<boolean> {
  try {
    await execAsync("ffmpeg -version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if FFprobe is available
 */
async function checkFFprobe(): Promise<boolean> {
  try {
    await execAsync("ffprobe -version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get media info using FFprobe
 */
async function getMediaInfoFFprobe(filePath: string): Promise<MediaInfo> {
  const hasFFprobe = await checkFFprobe();
  if (!hasFFprobe) {
    throw new Error("FFprobe not available");
  }
  
  const { stdout } = await execAsync(
    `ffprobe -v quiet -print_format json -show_format -show_streams "${filePath}"`
  );
  
  const data = JSON.parse(stdout);
  const format = data.format || {};
  const streams = data.streams || [];
  
  const videoStream = streams.find((s: any) => s.codec_type === "video");
  const audioStream = streams.find((s: any) => s.codec_type === "audio");
  
  let type: "image" | "audio" | "video" | "unknown" = "unknown";
  if (videoStream && !audioStream && format.duration === "N/A") {
    type = "image";
  } else if (videoStream) {
    type = "video";
  } else if (audioStream) {
    type = "audio";
  }
  
  const info: MediaInfo = {
    type,
    mimeType: format.format_name || "unknown",
    size: parseInt(format.size) || 0,
  };
  
  if (videoStream) {
    info.width = videoStream.width;
    info.height = videoStream.height;
    info.codec = videoStream.codec_name;
    info.frameRate = eval(videoStream.r_frame_rate); // e.g., "30/1"
    if (videoStream.nb_frames) {
      info.totalFrames = parseInt(videoStream.nb_frames);
    }
  }
  
  if (audioStream) {
    info.sampleRate = parseInt(audioStream.sample_rate);
    info.channels = audioStream.channels;
    info.codec = info.codec || audioStream.codec_name;
  }
  
  if (format.duration && format.duration !== "N/A") {
    info.duration = parseFloat(format.duration);
  }
  
  if (format.bit_rate) {
    info.bitrate = parseInt(format.bit_rate);
  }
  
  return info;
}

/**
 * Get basic image info without FFprobe (fallback)
 */
async function getBasicImageInfo(filePath: string): Promise<MediaInfo> {
  const stats = await fs.stat(filePath);
  const ext = path.extname(filePath).toLowerCase();
  
  const mimeTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
  };
  
  // Try to read image dimensions from header
  const buffer = Buffer.alloc(24);
  const fd = await fs.open(filePath, "r");
  await fs.read(fd, buffer, 0, 24, 0);
  await fs.close(fd);
  
  let width: number | undefined;
  let height: number | undefined;
  
  // PNG signature
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    width = buffer.readUInt32BE(16);
    height = buffer.readUInt32BE(20);
  }
  // JPEG signature
  else if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    // JPEG dimensions are more complex to extract
    // Would need to parse SOF markers
  }
  // GIF signature
  else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    width = buffer.readUInt16LE(6);
    height = buffer.readUInt16LE(8);
  }
  
  return {
    type: "image",
    mimeType: mimeTypes[ext] || "application/octet-stream",
    size: stats.size,
    width,
    height,
  };
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerMediaPipelineHandlers() {
  logger.info("Registering Media Pipeline handlers");

  // ========== Media Info ==========

  /**
   * Get media file information
   */
  ipcMain.handle("media-pipeline:get-info", async (_event, filePath: string) => {
    try {
      const ext = path.extname(filePath).toLowerCase();
      
      // Try FFprobe first
      try {
        return await getMediaInfoFFprobe(filePath);
      } catch {
        // Fall back to basic info for images
        if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext)) {
          return await getBasicImageInfo(filePath);
        }
        throw new Error("Cannot determine media info - FFprobe not available");
      }
    } catch (error) {
      logger.error("Get media info failed:", error);
      throw error;
    }
  });

  /**
   * Check available tools
   */
  ipcMain.handle("media-pipeline:check-tools", async () => {
    const [hasFFmpeg, hasFFprobe] = await Promise.all([
      checkFFmpeg(),
      checkFFprobe(),
    ]);
    
    return {
      ffmpeg: hasFFmpeg,
      ffprobe: hasFFprobe,
    };
  });

  // ========== Image Processing ==========

  /**
   * Process image with various operations
   */
  ipcMain.handle("media-pipeline:process-image", async (_event, args: {
    inputPath: string;
    outputPath?: string;
    options: ImageProcessOptions;
  }) => {
    try {
      const { inputPath, outputPath, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available for image processing");
      }
      
      const tempDir = await ensureTempDir();
      const outPath = outputPath || path.join(tempDir, `processed_${uuidv4()}${getExtension(options.format ? `image/${options.format}` : "image/png")}`);
      
      // Build FFmpeg filter chain
      const filters: string[] = [];
      
      if (options.resize) {
        const { width, height, mode } = options.resize;
        if (mode === "fit") {
          filters.push(`scale=${width}:${height}:force_original_aspect_ratio=decrease`);
        } else if (mode === "fill") {
          filters.push(`scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`);
        } else if (mode === "crop") {
          filters.push(`scale=${width}:${height}`);
        }
      }
      
      if (options.crop) {
        const { x, y, width, height } = options.crop;
        filters.push(`crop=${width}:${height}:${x}:${y}`);
      }
      
      if (options.rotate && options.rotate !== 0) {
        filters.push(`rotate=${options.rotate}*PI/180`);
      }
      
      if (options.grayscale) {
        filters.push("colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3");
      }
      
      if (options.blur && options.blur > 0) {
        filters.push(`boxblur=${options.blur}`);
      }
      
      // Build FFmpeg command
      let cmd = `ffmpeg -y -i "${inputPath}"`;
      
      if (filters.length > 0) {
        cmd += ` -vf "${filters.join(",")}"`;
      }
      
      if (options.quality && options.format === "jpeg") {
        cmd += ` -q:v ${Math.round((100 - options.quality) / 3)}`;
      }
      
      if (options.stripMetadata) {
        cmd += " -map_metadata -1";
      }
      
      cmd += ` "${outPath}"`;
      
      await execAsync(cmd);
      
      const info = await getBasicImageInfo(outPath);
      
      return {
        success: true,
        outputPath: outPath,
        info,
      };
    } catch (error) {
      logger.error("Image processing failed:", error);
      throw error;
    }
  });

  /**
   * Generate image thumbnail
   */
  ipcMain.handle("media-pipeline:generate-thumbnail", async (_event, args: {
    inputPath: string;
    options: ThumbnailOptions;
  }) => {
    try {
      const { inputPath, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const format = options.format || "jpeg";
      const outPath = path.join(tempDir, `thumb_${uuidv4()}.${format}`);
      
      let cmd = `ffmpeg -y -i "${inputPath}" -vf "scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2"`;
      
      if (options.timestamp !== undefined) {
        cmd = `ffmpeg -y -ss ${options.timestamp} -i "${inputPath}" -vframes 1 -vf "scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease"`;
      }
      
      if (options.quality && format === "jpeg") {
        cmd += ` -q:v ${Math.round((100 - options.quality) / 3)}`;
      }
      
      cmd += ` "${outPath}"`;
      
      await execAsync(cmd);
      
      return {
        success: true,
        thumbnailPath: outPath,
      };
    } catch (error) {
      logger.error("Thumbnail generation failed:", error);
      throw error;
    }
  });

  /**
   * Extract image metadata (EXIF, etc.)
   */
  ipcMain.handle("media-pipeline:extract-image-metadata", async (_event, filePath: string) => {
    try {
      const hasFFprobe = await checkFFprobe();
      
      if (!hasFFprobe) {
        return { metadata: {} };
      }
      
      const { stdout } = await execAsync(
        `ffprobe -v quiet -print_format json -show_entries format_tags "${filePath}"`
      );
      
      const data = JSON.parse(stdout);
      
      return {
        metadata: data.format?.tags || {},
      };
    } catch (error) {
      logger.error("Metadata extraction failed:", error);
      return { metadata: {} };
    }
  });

  /**
   * Strip image metadata
   */
  ipcMain.handle("media-pipeline:strip-metadata", async (_event, args: {
    inputPath: string;
    outputPath?: string;
  }) => {
    try {
      const { inputPath, outputPath } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const ext = path.extname(inputPath);
      const outPath = outputPath || path.join(tempDir, `clean_${uuidv4()}${ext}`);
      
      await execAsync(`ffmpeg -y -i "${inputPath}" -map_metadata -1 "${outPath}"`);
      
      return {
        success: true,
        outputPath: outPath,
      };
    } catch (error) {
      logger.error("Strip metadata failed:", error);
      throw error;
    }
  });

  // ========== Audio Processing ==========

  /**
   * Process audio file
   */
  ipcMain.handle("media-pipeline:process-audio", async (_event, args: {
    inputPath: string;
    outputPath?: string;
    options: AudioProcessOptions;
  }) => {
    try {
      const { inputPath, outputPath, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const format = options.format || "mp3";
      const outPath = outputPath || path.join(tempDir, `audio_${uuidv4()}.${format}`);
      
      let cmd = `ffmpeg -y -i "${inputPath}"`;
      
      if (options.trim) {
        cmd += ` -ss ${options.trim.start} -to ${options.trim.end}`;
      }
      
      if (options.sampleRate) {
        cmd += ` -ar ${options.sampleRate}`;
      }
      
      if (options.channels) {
        cmd += ` -ac ${options.channels}`;
      }
      
      if (options.bitrate) {
        cmd += ` -b:a ${options.bitrate}k`;
      }
      
      if (options.normalize) {
        cmd += ` -af "loudnorm=I=-16:TP=-1.5:LRA=11"`;
      }
      
      cmd += ` "${outPath}"`;
      
      await execAsync(cmd);
      
      const info = await getMediaInfoFFprobe(outPath);
      
      return {
        success: true,
        outputPath: outPath,
        info,
      };
    } catch (error) {
      logger.error("Audio processing failed:", error);
      throw error;
    }
  });

  /**
   * Extract audio waveform data
   */
  ipcMain.handle("media-pipeline:extract-waveform", async (_event, args: {
    inputPath: string;
    samplesPerSecond?: number;
  }) => {
    try {
      const { inputPath, samplesPerSecond = 100 } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      // Get duration first
      const info = await getMediaInfoFFprobe(inputPath);
      const duration = info.duration || 0;
      
      // Extract raw audio samples
      const tempDir = await ensureTempDir();
      const rawPath = path.join(tempDir, `waveform_${uuidv4()}.raw`);
      
      // Downsample to mono and extract raw samples
      await execAsync(
        `ffmpeg -y -i "${inputPath}" -ac 1 -ar ${samplesPerSecond * 10} -f s16le "${rawPath}"`
      );
      
      // Read raw data
      const rawData = await fs.readFile(rawPath);
      const samples: number[] = [];
      
      // Convert to normalized values (-1 to 1)
      for (let i = 0; i < rawData.length; i += 2) {
        const sample = rawData.readInt16LE(i) / 32768;
        samples.push(sample);
      }
      
      // Downsample to desired rate
      const targetSamples = Math.floor(duration * samplesPerSecond);
      const waveform: number[] = [];
      const step = samples.length / targetSamples;
      
      for (let i = 0; i < targetSamples; i++) {
        const start = Math.floor(i * step);
        const end = Math.floor((i + 1) * step);
        
        let max = 0;
        for (let j = start; j < end && j < samples.length; j++) {
          max = Math.max(max, Math.abs(samples[j]));
        }
        waveform.push(max);
      }
      
      // Cleanup
      await fs.remove(rawPath);
      
      return {
        success: true,
        waveform,
        duration,
        samplesPerSecond,
      };
    } catch (error) {
      logger.error("Waveform extraction failed:", error);
      throw error;
    }
  });

  // ========== Video Processing ==========

  /**
   * Process video file
   */
  ipcMain.handle("media-pipeline:process-video", async (_event, args: {
    inputPath: string;
    outputPath?: string;
    options: VideoProcessOptions;
  }) => {
    try {
      const { inputPath, outputPath, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const format = options.format || "mp4";
      const outPath = outputPath || path.join(tempDir, `video_${uuidv4()}.${format}`);
      
      let cmd = `ffmpeg -y -i "${inputPath}"`;
      
      if (options.trim) {
        cmd += ` -ss ${options.trim.start} -to ${options.trim.end}`;
      }
      
      const filters: string[] = [];
      
      if (options.resolution) {
        filters.push(`scale=${options.resolution.width}:${options.resolution.height}`);
      }
      
      if (options.frameRate) {
        filters.push(`fps=${options.frameRate}`);
      }
      
      if (filters.length > 0) {
        cmd += ` -vf "${filters.join(",")}"`;
      }
      
      if (options.removeAudio) {
        cmd += " -an";
      }
      
      cmd += ` "${outPath}"`;
      
      await execAsync(cmd);
      
      // Extract audio if requested
      let audioPath: string | undefined;
      if (options.extractAudio) {
        audioPath = path.join(tempDir, `audio_${uuidv4()}.mp3`);
        await execAsync(`ffmpeg -y -i "${inputPath}" -vn -acodec mp3 "${audioPath}"`);
      }
      
      const info = await getMediaInfoFFprobe(outPath);
      
      return {
        success: true,
        outputPath: outPath,
        audioPath,
        info,
      };
    } catch (error) {
      logger.error("Video processing failed:", error);
      throw error;
    }
  });

  /**
   * Extract frames from video
   */
  ipcMain.handle("media-pipeline:extract-frames", async (_event, args: {
    inputPath: string;
    outputDir?: string;
    options: FrameExtractionOptions;
  }) => {
    try {
      const { inputPath, outputDir, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const outDir = outputDir || path.join(tempDir, `frames_${uuidv4()}`);
      await fs.ensureDir(outDir);
      
      const format = options.format || "png";
      const quality = options.quality || 90;
      
      let cmd = `ffmpeg -y -i "${inputPath}"`;
      
      if (options.timestamps && options.timestamps.length > 0) {
        // Extract specific timestamps
        const frames: string[] = [];
        for (let i = 0; i < options.timestamps.length; i++) {
          const timestamp = options.timestamps[i];
          const framePath = path.join(outDir, `frame_${String(i).padStart(5, "0")}.${format}`);
          
          let frameCmd = `ffmpeg -y -ss ${timestamp} -i "${inputPath}" -vframes 1`;
          if (format === "jpeg" && quality) {
            frameCmd += ` -q:v ${Math.round((100 - quality) / 3)}`;
          }
          frameCmd += ` "${framePath}"`;
          
          await execAsync(frameCmd);
          frames.push(framePath);
        }
        
        return { success: true, outputDir: outDir, frames };
      } else if (options.interval) {
        // Extract every N seconds
        cmd += ` -vf "fps=1/${options.interval}"`;
      } else if (options.count) {
        // Extract N frames evenly distributed
        const info = await getMediaInfoFFprobe(inputPath);
        const duration = info.duration || 0;
        const interval = duration / options.count;
        cmd += ` -vf "fps=1/${interval}"`;
      } else {
        // Default: 1 frame per second
        cmd += ` -vf "fps=1"`;
      }
      
      if (format === "jpeg" && quality) {
        cmd += ` -q:v ${Math.round((100 - quality) / 3)}`;
      }
      
      cmd += ` "${path.join(outDir, `frame_%05d.${format}`)}"`;
      
      await execAsync(cmd);
      
      // List extracted frames
      const files = await fs.readdir(outDir);
      const frames = files
        .filter(f => f.startsWith("frame_") && f.endsWith(`.${format}`))
        .sort()
        .map(f => path.join(outDir, f));
      
      return {
        success: true,
        outputDir: outDir,
        frames,
        count: frames.length,
      };
    } catch (error) {
      logger.error("Frame extraction failed:", error);
      throw error;
    }
  });

  /**
   * Detect scene changes in video
   */
  ipcMain.handle("media-pipeline:detect-scenes", async (_event, args: {
    inputPath: string;
    threshold?: number;
  }) => {
    try {
      const { inputPath, threshold = 0.3 } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      // Use ffmpeg's scene detection filter
      const { stdout } = await execAsync(
        `ffmpeg -i "${inputPath}" -vf "select='gt(scene,${threshold})',showinfo" -f null - 2>&1 | grep "showinfo"`
      );
      
      const scenes: Array<{ timestamp: number; score: number }> = [];
      
      // Parse showinfo output
      const lines = stdout.split("\n");
      for (const line of lines) {
        const ptsTimeMatch = line.match(/pts_time:(\d+\.?\d*)/);
        if (ptsTimeMatch) {
          scenes.push({
            timestamp: parseFloat(ptsTimeMatch[1]),
            score: threshold,
          });
        }
      }
      
      return {
        success: true,
        scenes,
        count: scenes.length,
      };
    } catch (error) {
      // Scene detection might fail on some videos
      logger.warn("Scene detection failed:", error);
      return {
        success: true,
        scenes: [],
        count: 0,
        error: "Scene detection not available for this video",
      };
    }
  });

  /**
   * Generate video thumbnail/preview
   */
  ipcMain.handle("media-pipeline:video-thumbnail", async (_event, args: {
    inputPath: string;
    options: ThumbnailOptions;
  }) => {
    try {
      const { inputPath, options } = args;
      const hasFFmpeg = await checkFFmpeg();
      
      if (!hasFFmpeg) {
        throw new Error("FFmpeg not available");
      }
      
      const tempDir = await ensureTempDir();
      const format = options.format || "jpeg";
      const outPath = path.join(tempDir, `thumb_${uuidv4()}.${format}`);
      
      // Get video info for smart thumbnail selection
      const info = await getMediaInfoFFprobe(inputPath);
      const duration = info.duration || 0;
      
      // Default timestamp is 10% into the video or specified
      const timestamp = options.timestamp ?? duration * 0.1;
      
      let cmd = `ffmpeg -y -ss ${timestamp} -i "${inputPath}" -vframes 1 -vf "scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease"`;
      
      if (format === "jpeg" && options.quality) {
        cmd += ` -q:v ${Math.round((100 - options.quality) / 3)}`;
      }
      
      cmd += ` "${outPath}"`;
      
      await execAsync(cmd);
      
      return {
        success: true,
        thumbnailPath: outPath,
        timestamp,
      };
    } catch (error) {
      logger.error("Video thumbnail generation failed:", error);
      throw error;
    }
  });

  // ========== Batch Operations ==========

  /**
   * Batch process multiple files
   */
  ipcMain.handle("media-pipeline:batch-process", async (event, args: {
    files: Array<{
      inputPath: string;
      type: "image" | "audio" | "video";
      options: ImageProcessOptions | AudioProcessOptions | VideoProcessOptions;
    }>;
    outputDir?: string;
  }) => {
    try {
      const { files, outputDir } = args;
      const tempDir = outputDir || await ensureTempDir();
      await fs.ensureDir(tempDir);
      
      const results: Array<{
        inputPath: string;
        outputPath?: string;
        success: boolean;
        error?: string;
      }> = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        try {
          let outputPath: string;
          
          if (file.type === "image") {
            const result = await ipcMain.emit("media-pipeline:process-image", event, {
              inputPath: file.inputPath,
              options: file.options as ImageProcessOptions,
            }) as any;
            outputPath = result.outputPath;
          } else if (file.type === "audio") {
            const result = await ipcMain.emit("media-pipeline:process-audio", event, {
              inputPath: file.inputPath,
              options: file.options as AudioProcessOptions,
            }) as any;
            outputPath = result.outputPath;
          } else if (file.type === "video") {
            const result = await ipcMain.emit("media-pipeline:process-video", event, {
              inputPath: file.inputPath,
              options: file.options as VideoProcessOptions,
            }) as any;
            outputPath = result.outputPath;
          } else {
            throw new Error(`Unknown media type: ${file.type}`);
          }
          
          results.push({
            inputPath: file.inputPath,
            outputPath,
            success: true,
          });
        } catch (error) {
          results.push({
            inputPath: file.inputPath,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        
        // Report progress
        event.sender.send("media-pipeline:batch-progress", {
          current: i + 1,
          total: files.length,
          currentFile: file.inputPath,
        });
      }
      
      return {
        success: true,
        results,
        succeeded: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      };
    } catch (error) {
      logger.error("Batch processing failed:", error);
      throw error;
    }
  });

  // ========== Cleanup ==========

  /**
   * Clean up temporary files
   */
  ipcMain.handle("media-pipeline:cleanup-temp", async () => {
    try {
      const tempDir = getTempDir();
      if (await fs.pathExists(tempDir)) {
        await fs.emptyDir(tempDir);
      }
      return { success: true };
    } catch (error) {
      logger.error("Cleanup failed:", error);
      throw error;
    }
  });

  logger.info("Media Pipeline handlers registered");
}
