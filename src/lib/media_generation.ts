/**
 * Media Generation Service
 * Local image, audio, and video generation without cloud APIs.
 * Supports Stable Diffusion, Whisper, TTS, and more.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";

import type {
  MediaGenerationId,
  ImageGenerationJob,
  AudioGenerationJob,
  VideoGenerationJob,
  GeneratedMedia,
  MediaModel,
} from "@/types/sovereign_stack_types";

const logger = log.scope("media_generation");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MEDIA_DIR = path.join(app.getPath("userData"), "media_generation");

// Supported models
const SUPPORTED_IMAGE_MODELS: Record<string, MediaModel> = {
  "stable-diffusion-1.5": {
    id: "stable-diffusion-1.5",
    name: "Stable Diffusion 1.5",
    type: "image",
    size: "4GB",
    capabilities: ["txt2img", "img2img", "inpaint"],
    requirements: { vram: "6GB", platform: ["windows", "linux", "darwin"] },
  },
  "stable-diffusion-xl": {
    id: "stable-diffusion-xl",
    name: "Stable Diffusion XL",
    type: "image",
    size: "6.5GB",
    capabilities: ["txt2img", "img2img", "inpaint", "refine"],
    requirements: { vram: "10GB", platform: ["windows", "linux", "darwin"] },
  },
  "stable-diffusion-3": {
    id: "stable-diffusion-3",
    name: "Stable Diffusion 3",
    type: "image",
    size: "8GB",
    capabilities: ["txt2img", "img2img"],
    requirements: { vram: "12GB", platform: ["windows", "linux", "darwin"] },
  },
  "sdxl-turbo": {
    id: "sdxl-turbo",
    name: "SDXL Turbo",
    type: "image",
    size: "6.5GB",
    capabilities: ["txt2img"],
    requirements: { vram: "8GB", platform: ["windows", "linux", "darwin"] },
  },
  "kandinsky-2.2": {
    id: "kandinsky-2.2",
    name: "Kandinsky 2.2",
    type: "image",
    size: "5GB",
    capabilities: ["txt2img", "img2img", "inpaint"],
    requirements: { vram: "8GB", platform: ["windows", "linux", "darwin"] },
  },
};

const SUPPORTED_AUDIO_MODELS: Record<string, MediaModel> = {
  "whisper-base": {
    id: "whisper-base",
    name: "Whisper Base",
    type: "audio",
    size: "150MB",
    capabilities: ["transcribe", "translate"],
    requirements: { vram: "2GB", platform: ["windows", "linux", "darwin"] },
  },
  "whisper-medium": {
    id: "whisper-medium",
    name: "Whisper Medium",
    type: "audio",
    size: "750MB",
    capabilities: ["transcribe", "translate"],
    requirements: { vram: "4GB", platform: ["windows", "linux", "darwin"] },
  },
  "whisper-large": {
    id: "whisper-large",
    name: "Whisper Large v3",
    type: "audio",
    size: "1.5GB",
    capabilities: ["transcribe", "translate"],
    requirements: { vram: "6GB", platform: ["windows", "linux", "darwin"] },
  },
  "bark": {
    id: "bark",
    name: "Bark TTS",
    type: "audio",
    size: "5GB",
    capabilities: ["tts", "voice-clone"],
    requirements: { vram: "8GB", platform: ["windows", "linux", "darwin"] },
  },
  "coqui-tts": {
    id: "coqui-tts",
    name: "Coqui TTS",
    type: "audio",
    size: "500MB",
    capabilities: ["tts", "voice-clone"],
    requirements: { vram: "4GB", platform: ["windows", "linux", "darwin"] },
  },
  "musicgen": {
    id: "musicgen",
    name: "MusicGen",
    type: "audio",
    size: "3.3GB",
    capabilities: ["music-generation"],
    requirements: { vram: "8GB", platform: ["windows", "linux", "darwin"] },
  },
};

const SUPPORTED_VIDEO_MODELS: Record<string, MediaModel> = {
  "stable-video-diffusion": {
    id: "stable-video-diffusion",
    name: "Stable Video Diffusion",
    type: "video",
    size: "8GB",
    capabilities: ["img2vid"],
    requirements: { vram: "16GB", platform: ["windows", "linux"] },
  },
  "animatediff": {
    id: "animatediff",
    name: "AnimateDiff",
    type: "video",
    size: "2GB",
    capabilities: ["txt2vid", "img2vid"],
    requirements: { vram: "12GB", platform: ["windows", "linux", "darwin"] },
  },
};

// Default samplers
const SAMPLERS = [
  "euler",
  "euler_a",
  "heun",
  "dpm_2",
  "dpm_2_a",
  "lms",
  "dpm_fast",
  "dpm_adaptive",
  "dpmpp_2s_a",
  "dpmpp_2m",
  "dpmpp_sde",
  "ddim",
  "plms",
  "uni_pc",
];

// =============================================================================
// MEDIA GENERATION SERVICE
// =============================================================================

export class MediaGeneration extends EventEmitter {
  private mediaDir: string;
  private outputDir: string;
  private modelsDir: string;
  private installedModels: Map<string, MediaModel> = new Map();
  private runningJobs: Map<MediaGenerationId, ChildProcess> = new Map();
  private jobQueue: Map<MediaGenerationId, ImageGenerationJob | AudioGenerationJob | VideoGenerationJob> = new Map();
  private generatedMedia: Map<string, GeneratedMedia> = new Map();
  private comfyUIPath?: string;
  private automatic1111Path?: string;
  
  constructor(mediaDir?: string) {
    super();
    this.mediaDir = mediaDir || DEFAULT_MEDIA_DIR;
    this.outputDir = path.join(this.mediaDir, "output");
    this.modelsDir = path.join(this.mediaDir, "models");
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing media generation service", { dir: this.mediaDir });
    
    await fs.mkdir(this.mediaDir, { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(this.modelsDir, { recursive: true });
    await fs.mkdir(path.join(this.modelsDir, "checkpoints"), { recursive: true });
    await fs.mkdir(path.join(this.modelsDir, "loras"), { recursive: true });
    await fs.mkdir(path.join(this.modelsDir, "vae"), { recursive: true });
    await fs.mkdir(path.join(this.modelsDir, "embeddings"), { recursive: true });
    
    await this.scanInstalledModels();
    await this.loadGeneratedMedia();
    
    // Check for local backends
    await this.detectBackends();
    
    logger.info("Media generation initialized", {
      models: this.installedModels.size,
      media: this.generatedMedia.size,
    });
  }
  
  private async detectBackends(): Promise<void> {
    // Check for ComfyUI
    const comfyPaths = [
      path.join(app.getPath("home"), "ComfyUI"),
      "C:\\ComfyUI",
      "/opt/ComfyUI",
    ];
    
    for (const p of comfyPaths) {
      if (existsSync(path.join(p, "main.py"))) {
        this.comfyUIPath = p;
        logger.info("Found ComfyUI", { path: p });
        break;
      }
    }
    
    // Check for Automatic1111
    const a1111Paths = [
      path.join(app.getPath("home"), "stable-diffusion-webui"),
      "C:\\stable-diffusion-webui",
      "/opt/stable-diffusion-webui",
    ];
    
    for (const p of a1111Paths) {
      if (existsSync(path.join(p, "webui.py"))) {
        this.automatic1111Path = p;
        logger.info("Found Automatic1111", { path: p });
        break;
      }
    }
  }
  
  private async scanInstalledModels(): Promise<void> {
    const checkpointsDir = path.join(this.modelsDir, "checkpoints");
    if (existsSync(checkpointsDir)) {
      const files = await fs.readdir(checkpointsDir);
      for (const file of files) {
        if (file.endsWith(".safetensors") || file.endsWith(".ckpt")) {
          const modelName = file.replace(/\.(safetensors|ckpt)$/, "");
          this.installedModels.set(modelName, {
            id: modelName,
            name: modelName,
            type: "image",
            size: "Unknown",
            capabilities: ["txt2img"],
            localPath: path.join(checkpointsDir, file),
          });
        }
      }
    }
  }
  
  private async loadGeneratedMedia(): Promise<void> {
    const metaPath = path.join(this.mediaDir, "generated.json");
    if (existsSync(metaPath)) {
      const data = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      for (const item of data) {
        this.generatedMedia.set(item.id, item);
      }
    }
  }
  
  private async saveGeneratedMedia(): Promise<void> {
    const metaPath = path.join(this.mediaDir, "generated.json");
    await fs.writeFile(metaPath, JSON.stringify(Array.from(this.generatedMedia.values()), null, 2));
  }
  
  // ===========================================================================
  // IMAGE GENERATION
  // ===========================================================================
  
  async generateImage(params: {
    prompt: string;
    negativePrompt?: string;
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    cfgScale?: number;
    sampler?: string;
    seed?: number;
    batchSize?: number;
    scheduler?: string;
    clipSkip?: number;
    loraModels?: Array<{ name: string; weight: number }>;
    controlnet?: {
      model: string;
      image: string;
      weight: number;
    };
    img2img?: {
      image: string;
      denoisingStrength: number;
    };
    inpaint?: {
      image: string;
      mask: string;
    };
    metadata?: Record<string, unknown>;
  }): Promise<ImageGenerationJob> {
    const id = crypto.randomUUID() as MediaGenerationId;
    
    const job: ImageGenerationJob = {
      id,
      type: "image",
      status: "pending",
      prompt: params.prompt,
      negativePrompt: params.negativePrompt || "",
      model: params.model || "stable-diffusion-1.5",
      width: params.width || 512,
      height: params.height || 512,
      steps: params.steps || 20,
      cfgScale: params.cfgScale || 7,
      sampler: params.sampler || "euler_a",
      seed: params.seed || Math.floor(Math.random() * 2147483647),
      batchSize: params.batchSize || 1,
      scheduler: params.scheduler,
      clipSkip: params.clipSkip,
      loraModels: params.loraModels,
      controlnet: params.controlnet,
      img2img: params.img2img,
      inpaint: params.inpaint,
      progress: 0,
      config: {},
      outputs: [],
      metadata: params.metadata,
      createdAt: Date.now(),
    };
    
    this.jobQueue.set(id, job);
    this.emit("job:created", job);
    
    // Start generation
    this.executeImageGeneration(job).catch((error) => {
      job.status = "failed";
      job.error = error.message;
      this.emit("job:failed", { job, error });
    });
    
    return job;
  }
  
  private async executeImageGeneration(job: ImageGenerationJob): Promise<void> {
    job.status = "running";
    job.startedAt = Date.now();
    this.emit("job:started", job);
    
    // Use diffusers backend (Python)
    const scriptContent = this.generateImageScript(job);
    const scriptPath = path.join(this.mediaDir, `gen_${job.id}.py`);
    await fs.writeFile(scriptPath, scriptContent);
    
    const outputPath = path.join(this.outputDir, job.id);
    await fs.mkdir(outputPath, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCommand, [scriptPath], {
        env: {
          ...process.env,
          HF_HOME: path.join(this.modelsDir, "hf_cache"),
        },
      });
      
      this.runningJobs.set(job.id, proc);
      
      proc.stdout.on("data", (data) => {
        const output = data.toString();
        
        // Parse progress
        const progressMatch = output.match(/\[PROGRESS\]\s+(\d+)/);
        if (progressMatch) {
          job.progress = parseInt(progressMatch[1]);
          this.emit("job:progress", { job, progress: job.progress });
        }
      });
      
      proc.stderr.on("data", (data) => {
        logger.warn("Image generation stderr", { output: data.toString() });
      });
      
      proc.on("close", async (code) => {
        this.runningJobs.delete(job.id);
        await fs.unlink(scriptPath).catch(() => {});
        
        if (code === 0) {
          job.status = "completed";
          job.completedAt = Date.now();
          job.progress = 100;
          
          // Find generated images
          const files = await fs.readdir(outputPath);
          const outputPaths = files
            .filter((f) => f.endsWith(".png") || f.endsWith(".jpg"))
            .map((f) => path.join(outputPath, f));
          
          // Build outputs and save to generated media
          job.outputs = [];
          for (let i = 0; i < outputPaths.length; i++) {
            const media: GeneratedMedia = {
              id: `${job.id}_${i}`,
              type: "image",
              path: outputPaths[i],
              prompt: job.prompt,
              model: job.model,
              seed: (job.seed || 0) + i,
              parameters: {
                width: job.width,
                height: job.height,
                steps: job.steps,
                cfgScale: job.cfgScale,
                sampler: job.sampler,
              },
              createdAt: Date.now(),
            };
            job.outputs.push(media);
            this.generatedMedia.set(media.id, media);
          }
          
          await this.saveGeneratedMedia();
          this.emit("job:completed", job);
          resolve();
        } else {
          job.status = "failed";
          job.error = `Process exited with code ${code}`;
          reject(new Error(job.error));
        }
      });
      
      proc.on("error", (error) => {
        this.runningJobs.delete(job.id);
        job.status = "failed";
        job.error = error.message;
        reject(error);
      });
    });
  }
  
  private generateImageScript(job: ImageGenerationJob): string {
    return `
#!/usr/bin/env python3
"""
Image Generation Script
Generated by JoyCreate Media Generation Service
"""

import os
import torch
from diffusers import (
    StableDiffusionPipeline,
    StableDiffusionXLPipeline,
    EulerAncestralDiscreteScheduler,
    DPMSolverMultistepScheduler,
)

OUTPUT_DIR = "${path.join(this.outputDir, job.id).replace(/\\/g, "/")}"
MODEL = "${job.model}"
PROMPT = """${(job.prompt || "").replace(/"/g, '\\"')}"""
NEGATIVE_PROMPT = """${job.negativePrompt?.replace(/"/g, '\\"') || ""}"""
WIDTH = ${job.width}
HEIGHT = ${job.height}
STEPS = ${job.steps}
CFG_SCALE = ${job.cfgScale}
SEED = ${job.seed}
BATCH_SIZE = ${job.batchSize}

def main():
    print("[PROGRESS] 0")
    
    # Select pipeline based on model
    if "xl" in MODEL.lower():
        pipeline_class = StableDiffusionXLPipeline
    else:
        pipeline_class = StableDiffusionPipeline
    
    # Load model
    print("[PROGRESS] 10")
    
    model_id = {
        "stable-diffusion-1.5": "runwayml/stable-diffusion-v1-5",
        "stable-diffusion-xl": "stabilityai/stable-diffusion-xl-base-1.0",
        "stable-diffusion-3": "stabilityai/stable-diffusion-3-medium",
        "sdxl-turbo": "stabilityai/sdxl-turbo",
    }.get(MODEL, MODEL)
    
    pipe = pipeline_class.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
        use_safetensors=True,
    )
    
    # Move to GPU if available
    device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = pipe.to(device)
    
    # Enable memory optimizations
    if device == "cuda":
        pipe.enable_model_cpu_offload()
    
    print("[PROGRESS] 30")
    
    # Set scheduler
    ${job.sampler === "euler_a" ? "pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)" : ""}
    ${job.sampler === "dpmpp_2m" ? "pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)" : ""}
    
    # Generate
    generator = torch.Generator(device=device).manual_seed(SEED)
    
    print("[PROGRESS] 50")
    
    images = pipe(
        prompt=PROMPT,
        negative_prompt=NEGATIVE_PROMPT if NEGATIVE_PROMPT else None,
        width=WIDTH,
        height=HEIGHT,
        num_inference_steps=STEPS,
        guidance_scale=CFG_SCALE,
        num_images_per_prompt=BATCH_SIZE,
        generator=generator,
    ).images
    
    print("[PROGRESS] 90")
    
    # Save images
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for i, image in enumerate(images):
        image.save(os.path.join(OUTPUT_DIR, f"image_{i:04d}.png"))
    
    print("[PROGRESS] 100")

if __name__ == "__main__":
    main()
`;
  }
  
  // ===========================================================================
  // AUDIO GENERATION
  // ===========================================================================
  
  async generateAudio(params: {
    type: "tts" | "transcribe" | "music";
    text?: string;
    audioFile?: string;
    model?: string;
    voice?: string;
    language?: string;
    duration?: number;
    metadata?: Record<string, unknown>;
  }): Promise<AudioGenerationJob> {
    const id = crypto.randomUUID() as MediaGenerationId;
    
    const job: AudioGenerationJob = {
      id,
      type: "audio",
      audioType: params.type,
      status: "pending",
      prompt: params.text || "",
      text: params.text,
      audioFile: params.audioFile,
      model: params.model || (params.type === "transcribe" ? "whisper-base" : "bark"),
      voice: params.voice,
      language: params.language,
      duration: params.duration,
      progress: 0,
      config: {},
      outputs: [],
      metadata: params.metadata,
      createdAt: Date.now(),
    };
    
    this.jobQueue.set(id, job);
    this.emit("job:created", job);
    
    // Start generation
    this.executeAudioGeneration(job).catch((error) => {
      job.status = "failed";
      job.error = error.message;
      this.emit("job:failed", { job, error });
    });
    
    return job;
  }
  
  private async executeAudioGeneration(job: AudioGenerationJob): Promise<void> {
    job.status = "running";
    job.startedAt = Date.now();
    this.emit("job:started", job);
    
    const scriptContent = this.generateAudioScript(job);
    const scriptPath = path.join(this.mediaDir, `audio_${job.id}.py`);
    await fs.writeFile(scriptPath, scriptContent);
    
    const outputPath = path.join(this.outputDir, job.id);
    await fs.mkdir(outputPath, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCommand, [scriptPath], {
        env: {
          ...process.env,
          HF_HOME: path.join(this.modelsDir, "hf_cache"),
        },
      });
      
      this.runningJobs.set(job.id, proc);
      
      proc.stdout.on("data", (data) => {
        const output = data.toString();
        
        const progressMatch = output.match(/\[PROGRESS\]\s+(\d+)/);
        if (progressMatch) {
          job.progress = parseInt(progressMatch[1]);
          this.emit("job:progress", { job, progress: job.progress });
        }
        
        // Capture transcription result
        const transcriptMatch = output.match(/\[TRANSCRIPT\]\s+(.+)/);
        if (transcriptMatch) {
          job.transcript = transcriptMatch[1];
        }
      });
      
      proc.on("close", async (code) => {
        this.runningJobs.delete(job.id);
        await fs.unlink(scriptPath).catch(() => {});
        
        if (code === 0) {
          job.status = "completed";
          job.completedAt = Date.now();
          job.progress = 100;
          
          // Find output files
          const files = await fs.readdir(outputPath);
          const audioFiles = files.filter((f) => 
            f.endsWith(".wav") || f.endsWith(".mp3") || f.endsWith(".flac")
          );
          
          if (audioFiles.length > 0) {
            job.output = path.join(outputPath, audioFiles[0]);
          }
          
          await this.saveGeneratedMedia();
          this.emit("job:completed", job);
          resolve();
        } else {
          job.status = "failed";
          job.error = `Process exited with code ${code}`;
          reject(new Error(job.error));
        }
      });
      
      proc.on("error", (error) => {
        this.runningJobs.delete(job.id);
        reject(error);
      });
    });
  }
  
  private generateAudioScript(job: AudioGenerationJob): string {
    const outputDir = path.join(this.outputDir, job.id).replace(/\\/g, "/");
    
    if (job.audioType === "transcribe") {
      return `
#!/usr/bin/env python3
"""
Audio Transcription Script (Whisper)
"""

import os
import whisper

OUTPUT_DIR = "${outputDir}"
AUDIO_FILE = "${job.audioFile?.replace(/\\/g, "/") || ""}"
MODEL = "${job.model || "base"}"
LANGUAGE = ${job.language ? `"${job.language}"` : "None"}

def main():
    print("[PROGRESS] 0")
    
    # Load model
    model_name = MODEL.replace("whisper-", "")
    model = whisper.load_model(model_name)
    
    print("[PROGRESS] 30")
    
    # Transcribe
    result = model.transcribe(
        AUDIO_FILE,
        language=LANGUAGE,
        verbose=False,
    )
    
    print("[PROGRESS] 90")
    
    # Save transcript
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(os.path.join(OUTPUT_DIR, "transcript.txt"), "w", encoding="utf-8") as f:
        f.write(result["text"])
    
    print(f"[TRANSCRIPT] {result['text']}")
    print("[PROGRESS] 100")

if __name__ == "__main__":
    main()
`;
    } else if (job.audioType === "tts") {
      return `
#!/usr/bin/env python3
"""
Text-to-Speech Script (Bark)
"""

import os
import torch
import scipy.io.wavfile as wavfile

OUTPUT_DIR = "${outputDir}"
TEXT = """${job.text?.replace(/"/g, '\\"') || ""}"""
VOICE = "${job.voice || "v2/en_speaker_6"}"

def main():
    print("[PROGRESS] 0")
    
    from transformers import AutoProcessor, BarkModel
    
    # Load model
    processor = AutoProcessor.from_pretrained("suno/bark")
    model = BarkModel.from_pretrained("suno/bark")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    
    print("[PROGRESS] 30")
    
    # Generate
    inputs = processor(TEXT, voice_preset=VOICE)
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    print("[PROGRESS] 50")
    
    audio_array = model.generate(**inputs)
    audio_array = audio_array.cpu().numpy().squeeze()
    
    print("[PROGRESS] 90")
    
    # Save
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    sample_rate = model.generation_config.sample_rate
    wavfile.write(os.path.join(OUTPUT_DIR, "output.wav"), sample_rate, audio_array)
    
    print("[PROGRESS] 100")

if __name__ == "__main__":
    main()
`;
    } else if (job.audioType === "music") {
      return `
#!/usr/bin/env python3
"""
Music Generation Script (MusicGen)
"""

import os
import torch
import scipy.io.wavfile as wavfile

OUTPUT_DIR = "${outputDir}"
PROMPT = """${job.text?.replace(/"/g, '\\"') || ""}"""
DURATION = ${job.duration || 10}

def main():
    print("[PROGRESS] 0")
    
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    
    # Load model
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = model.to(device)
    
    print("[PROGRESS] 30")
    
    # Generate
    inputs = processor(
        text=[PROMPT],
        padding=True,
        return_tensors="pt",
    ).to(device)
    
    print("[PROGRESS] 50")
    
    audio_values = model.generate(**inputs, max_new_tokens=256 * DURATION)
    
    print("[PROGRESS] 90")
    
    # Save
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    sampling_rate = model.config.audio_encoder.sampling_rate
    audio_data = audio_values[0, 0].cpu().numpy()
    wavfile.write(os.path.join(OUTPUT_DIR, "music.wav"), sampling_rate, audio_data)
    
    print("[PROGRESS] 100")

if __name__ == "__main__":
    main()
`;
    }
    
    return "# Unknown audio type";
  }
  
  // ===========================================================================
  // VIDEO GENERATION
  // ===========================================================================
  
  async generateVideo(params: {
    type: "img2vid" | "txt2vid";
    prompt?: string;
    image?: string;
    model?: string;
    frames?: number;
    fps?: number;
    width?: number;
    height?: number;
    seed?: number;
    metadata?: Record<string, unknown>;
  }): Promise<VideoGenerationJob> {
    const id = crypto.randomUUID() as MediaGenerationId;
    
    const job: VideoGenerationJob = {
      id,
      type: "video",
      videoType: params.type,
      status: "pending",
      prompt: params.prompt || "",
      image: params.image,
      model: params.model || "stable-video-diffusion",
      frames: params.frames || 25,
      fps: params.fps || 7,
      width: params.width || 1024,
      height: params.height || 576,
      seed: params.seed || Math.floor(Math.random() * 2147483647),
      progress: 0,
      config: {},
      outputs: [],
      metadata: params.metadata,
      createdAt: Date.now(),
    } as VideoGenerationJob;
    
    this.jobQueue.set(id, job);
    this.emit("job:created", job);
    
    // Start generation
    this.executeVideoGeneration(job).catch((error) => {
      job.status = "failed";
      job.error = error.message;
      this.emit("job:failed", { job, error });
    });
    
    return job;
  }
  
  private async executeVideoGeneration(job: VideoGenerationJob): Promise<void> {
    job.status = "running";
    job.startedAt = Date.now();
    this.emit("job:started", job);
    
    const scriptContent = this.generateVideoScript(job);
    const scriptPath = path.join(this.mediaDir, `video_${job.id}.py`);
    await fs.writeFile(scriptPath, scriptContent);
    
    const outputPath = path.join(this.outputDir, job.id);
    await fs.mkdir(outputPath, { recursive: true });
    
    return new Promise((resolve, reject) => {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCommand, [scriptPath], {
        env: {
          ...process.env,
          HF_HOME: path.join(this.modelsDir, "hf_cache"),
        },
      });
      
      this.runningJobs.set(job.id, proc);
      
      proc.stdout.on("data", (data) => {
        const output = data.toString();
        
        const progressMatch = output.match(/\[PROGRESS\]\s+(\d+)/);
        if (progressMatch) {
          job.progress = parseInt(progressMatch[1]);
          this.emit("job:progress", { job, progress: job.progress });
        }
      });
      
      proc.on("close", async (code) => {
        this.runningJobs.delete(job.id);
        await fs.unlink(scriptPath).catch(() => {});
        
        if (code === 0) {
          job.status = "completed";
          job.completedAt = Date.now();
          job.progress = 100;
          
          // Find output video
          const files = await fs.readdir(outputPath);
          const videoFile = files.find((f) => f.endsWith(".mp4") || f.endsWith(".webm"));
          if (videoFile) {
            job.output = path.join(outputPath, videoFile);
          }
          
          this.emit("job:completed", job);
          resolve();
        } else {
          job.status = "failed";
          job.error = `Process exited with code ${code}`;
          reject(new Error(job.error));
        }
      });
      
      proc.on("error", (error) => {
        this.runningJobs.delete(job.id);
        reject(error);
      });
    });
  }
  
  private generateVideoScript(job: VideoGenerationJob): string {
    const outputDir = path.join(this.outputDir, job.id).replace(/\\/g, "/");
    
    return `
#!/usr/bin/env python3
"""
Video Generation Script (Stable Video Diffusion)
"""

import os
import torch
from PIL import Image
from diffusers import StableVideoDiffusionPipeline
from diffusers.utils import export_to_video

OUTPUT_DIR = "${outputDir}"
IMAGE_PATH = "${job.image?.replace(/\\/g, "/") || ""}"
NUM_FRAMES = ${job.frames}
FPS = ${job.fps}
WIDTH = ${job.width}
HEIGHT = ${job.height}
SEED = ${job.seed}

def main():
    print("[PROGRESS] 0")
    
    # Load pipeline
    pipe = StableVideoDiffusionPipeline.from_pretrained(
        "stabilityai/stable-video-diffusion-img2vid-xt",
        torch_dtype=torch.float16,
        variant="fp16",
    )
    
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipe = pipe.to(device)
    
    if device == "cuda":
        pipe.enable_model_cpu_offload()
    
    print("[PROGRESS] 20")
    
    # Load and resize image
    image = Image.open(IMAGE_PATH)
    image = image.resize((WIDTH, HEIGHT))
    
    print("[PROGRESS] 30")
    
    # Generate
    generator = torch.Generator(device=device).manual_seed(SEED)
    
    frames = pipe(
        image,
        num_frames=NUM_FRAMES,
        decode_chunk_size=8,
        generator=generator,
    ).frames[0]
    
    print("[PROGRESS] 90")
    
    # Save video
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    export_to_video(frames, os.path.join(OUTPUT_DIR, "output.mp4"), fps=FPS)
    
    print("[PROGRESS] 100")

if __name__ == "__main__":
    main()
`;
  }
  
  // ===========================================================================
  // JOB MANAGEMENT
  // ===========================================================================
  
  getJob(id: MediaGenerationId): ImageGenerationJob | AudioGenerationJob | VideoGenerationJob | null {
    return this.jobQueue.get(id) || null;
  }
  
  listJobs(): Array<ImageGenerationJob | AudioGenerationJob | VideoGenerationJob> {
    return Array.from(this.jobQueue.values());
  }
  
  async cancelJob(id: MediaGenerationId): Promise<void> {
    const proc = this.runningJobs.get(id);
    if (proc) {
      proc.kill("SIGTERM");
      this.runningJobs.delete(id);
    }
    
    const job = this.jobQueue.get(id);
    if (job) {
      job.status = "cancelled";
      this.emit("job:cancelled", job);
    }
  }
  
  // ===========================================================================
  // MEDIA MANAGEMENT
  // ===========================================================================
  
  listGeneratedMedia(type?: "image" | "audio" | "video"): GeneratedMedia[] {
    const all = Array.from(this.generatedMedia.values());
    if (type) {
      return all.filter((m) => m.type === type);
    }
    return all;
  }
  
  getGeneratedMedia(id: string): GeneratedMedia | null {
    return this.generatedMedia.get(id) || null;
  }
  
  async deleteGeneratedMedia(id: string): Promise<void> {
    const media = this.generatedMedia.get(id);
    if (media && existsSync(media.path)) {
      await fs.unlink(media.path);
    }
    this.generatedMedia.delete(id);
    await this.saveGeneratedMedia();
  }
  
  // ===========================================================================
  // MODEL MANAGEMENT
  // ===========================================================================
  
  getSupportedImageModels(): Record<string, MediaModel> {
    return SUPPORTED_IMAGE_MODELS;
  }
  
  getSupportedAudioModels(): Record<string, MediaModel> {
    return SUPPORTED_AUDIO_MODELS;
  }
  
  getSupportedVideoModels(): Record<string, MediaModel> {
    return SUPPORTED_VIDEO_MODELS;
  }
  
  getInstalledModels(): MediaModel[] {
    return Array.from(this.installedModels.values());
  }
  
  getSamplers(): string[] {
    return SAMPLERS;
  }
  
  async shutdown(): Promise<void> {
    // Cancel all running jobs
    for (const [id, proc] of this.runningJobs) {
      proc.kill("SIGTERM");
      this.runningJobs.delete(id);
    }
    
    await this.saveGeneratedMedia();
  }
}

// Export singleton
export const mediaGeneration = new MediaGeneration();
