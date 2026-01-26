/**
 * Local Fine-tuning Service
 * LoRA and QLoRA fine-tuning on local hardware without cloud services.
 * Supports training, evaluation, and model merging.
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
  FineTuneJobId,
  FineTuneJob,
  TrainingDataset,
  TrainingConfig,
  TrainingProgress,
  ModelAdapter,
  EvaluationResult,
} from "@/types/sovereign_stack_types";

const logger = log.scope("local_fine_tuning");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_FINETUNING_DIR = path.join(app.getPath("userData"), "fine_tuning");

// Supported base models
const SUPPORTED_BASE_MODELS = {
  "llama-2-7b": {
    name: "Llama 2 7B",
    parameters: "7B",
    memory: "14GB",
    format: "gguf",
  },
  "llama-2-13b": {
    name: "Llama 2 13B",
    parameters: "13B",
    memory: "26GB",
    format: "gguf",
  },
  "mistral-7b": {
    name: "Mistral 7B",
    parameters: "7B",
    memory: "14GB",
    format: "gguf",
  },
  "phi-2": {
    name: "Phi-2",
    parameters: "2.7B",
    memory: "6GB",
    format: "gguf",
  },
  "tinyllama": {
    name: "TinyLlama",
    parameters: "1.1B",
    memory: "2.5GB",
    format: "gguf",
  },
  "codellama-7b": {
    name: "CodeLlama 7B",
    parameters: "7B",
    memory: "14GB",
    format: "gguf",
  },
};

// Default training configs
const DEFAULT_TRAINING_CONFIGS = {
  lora: {
    loraR: 8,
    loraAlpha: 16,
    loraDropout: 0.05,
    targetModules: ["q_proj", "v_proj"],
    batchSize: 4,
    learningRate: 2e-4,
    epochs: 3,
    warmupSteps: 100,
    maxGradNorm: 0.3,
    gradientAccumulationSteps: 4,
    optimizer: "adamw" as const,
    scheduler: "cosine" as const,
  },
  qlora: {
    loraR: 16,
    loraAlpha: 32,
    loraDropout: 0.05,
    targetModules: ["q_proj", "k_proj", "v_proj", "o_proj"],
    batchSize: 2,
    learningRate: 2e-4,
    epochs: 3,
    warmupSteps: 50,
    maxGradNorm: 0.3,
    gradientAccumulationSteps: 8,
    optimizer: "paged_adamw_8bit" as const,
    scheduler: "cosine" as const,
    quantizationBits: 4,
    nf4: true,
    doublequant: true,
  },
  full: {
    batchSize: 1,
    learningRate: 1e-5,
    epochs: 1,
    warmupSteps: 100,
    maxGradNorm: 1.0,
    gradientAccumulationSteps: 16,
    optimizer: "adamw" as const,
    scheduler: "linear" as const,
  },
};

// =============================================================================
// LOCAL FINE-TUNING SERVICE
// =============================================================================

export class LocalFineTuning extends EventEmitter {
  private fineTuningDir: string;
  private datasetsDir: string;
  private adaptersDir: string;
  private logsDir: string;
  private jobs: Map<FineTuneJobId, FineTuneJob> = new Map();
  private datasets: Map<string, TrainingDataset> = new Map();
  private adapters: Map<string, ModelAdapter> = new Map();
  private runningProcesses: Map<FineTuneJobId, ChildProcess> = new Map();
  
  constructor(fineTuningDir?: string) {
    super();
    this.fineTuningDir = fineTuningDir || DEFAULT_FINETUNING_DIR;
    this.datasetsDir = path.join(this.fineTuningDir, "datasets");
    this.adaptersDir = path.join(this.fineTuningDir, "adapters");
    this.logsDir = path.join(this.fineTuningDir, "logs");
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing local fine-tuning service", { dir: this.fineTuningDir });
    
    await fs.mkdir(this.fineTuningDir, { recursive: true });
    await fs.mkdir(this.datasetsDir, { recursive: true });
    await fs.mkdir(this.adaptersDir, { recursive: true });
    await fs.mkdir(this.logsDir, { recursive: true });
    
    await this.loadJobs();
    await this.loadDatasets();
    await this.loadAdapters();
    
    logger.info("Local fine-tuning initialized", {
      jobs: this.jobs.size,
      datasets: this.datasets.size,
      adapters: this.adapters.size,
    });
  }
  
  private async loadJobs(): Promise<void> {
    const jobsPath = path.join(this.fineTuningDir, "jobs.json");
    if (existsSync(jobsPath)) {
      const jobs = JSON.parse(await fs.readFile(jobsPath, "utf-8"));
      for (const job of jobs) {
        this.jobs.set(job.id as FineTuneJobId, job);
      }
    }
  }
  
  private async saveJobs(): Promise<void> {
    const jobsPath = path.join(this.fineTuningDir, "jobs.json");
    await fs.writeFile(jobsPath, JSON.stringify(Array.from(this.jobs.values()), null, 2));
  }
  
  private async loadDatasets(): Promise<void> {
    const entries = await fs.readdir(this.datasetsDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = path.join(this.datasetsDir, entry.name, "metadata.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
          this.datasets.set(meta.id, meta);
        }
      }
    }
  }
  
  private async loadAdapters(): Promise<void> {
    const entries = await fs.readdir(this.adaptersDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metaPath = path.join(this.adaptersDir, entry.name, "adapter_config.json");
        if (existsSync(metaPath)) {
          const meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
          this.adapters.set(meta.id, meta);
        }
      }
    }
  }
  
  // ===========================================================================
  // DATASET MANAGEMENT
  // ===========================================================================
  
  async createDataset(params: {
    name: string;
    description?: string;
    format: "alpaca" | "sharegpt" | "oasst" | "custom";
    data: Array<{ input: string; output: string; instruction?: string }>;
    validationSplit?: number;
    metadata?: Record<string, unknown>;
  }): Promise<TrainingDataset> {
    const id = crypto.randomUUID();
    const datasetDir = path.join(this.datasetsDir, id);
    await fs.mkdir(datasetDir, { recursive: true });
    
    // Calculate statistics
    const totalSamples = params.data.length;
    const avgInputLen = params.data.reduce((sum, d) => sum + d.input.length, 0) / totalSamples;
    const avgOutputLen = params.data.reduce((sum, d) => sum + d.output.length, 0) / totalSamples;
    
    // Split into train/validation
    const validationSplit = params.validationSplit || 0.1;
    const splitIndex = Math.floor(totalSamples * (1 - validationSplit));
    
    const shuffled = [...params.data].sort(() => Math.random() - 0.5);
    const trainData = shuffled.slice(0, splitIndex);
    const valData = shuffled.slice(splitIndex);
    
    // Format data based on format type
    const formatData = (data: typeof params.data) => {
      switch (params.format) {
        case "alpaca":
          return data.map((d) => ({
            instruction: d.instruction || "",
            input: d.input,
            output: d.output,
          }));
        case "sharegpt":
          return data.map((d) => ({
            conversations: [
              { from: "human", value: d.input },
              { from: "gpt", value: d.output },
            ],
          }));
        case "oasst":
          return data.map((d) => ({
            INSTRUCTION: d.instruction || d.input,
            RESPONSE: d.output,
          }));
        default:
          return data;
      }
    };
    
    // Save train and validation sets
    await fs.writeFile(
      path.join(datasetDir, "train.jsonl"),
      formatData(trainData).map((d) => JSON.stringify(d)).join("\n")
    );
    
    await fs.writeFile(
      path.join(datasetDir, "validation.jsonl"),
      formatData(valData).map((d) => JSON.stringify(d)).join("\n")
    );
    
    const dataset: TrainingDataset = {
      id,
      name: params.name,
      description: params.description,
      format: params.format,
      path: datasetDir,
      trainSamples: trainData.length,
      validationSamples: valData.length,
      statistics: {
        totalSamples,
        avgInputLength: Math.round(avgInputLen),
        avgOutputLength: Math.round(avgOutputLen),
        maxInputLength: Math.max(...params.data.map((d) => d.input.length)),
        maxOutputLength: Math.max(...params.data.map((d) => d.output.length)),
      },
      metadata: params.metadata,
      createdAt: Date.now(),
    };
    
    await fs.writeFile(path.join(datasetDir, "metadata.json"), JSON.stringify(dataset, null, 2));
    this.datasets.set(id, dataset);
    
    this.emit("dataset:created", dataset);
    
    return dataset;
  }
  
  async importDataset(params: {
    name: string;
    filePath: string;
    format: "alpaca" | "sharegpt" | "oasst" | "custom";
    description?: string;
  }): Promise<TrainingDataset> {
    const content = await fs.readFile(params.filePath, "utf-8");
    let data: Array<{ input: string; output: string; instruction?: string }>;
    
    // Parse based on file extension
    if (params.filePath.endsWith(".jsonl")) {
      const lines = content.split("\n").filter((l) => l.trim());
      data = lines.map((line) => {
        const parsed = JSON.parse(line);
        return this.parseDataItem(parsed, params.format);
      });
    } else if (params.filePath.endsWith(".json")) {
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      data = items.map((item) => this.parseDataItem(item, params.format));
    } else if (params.filePath.endsWith(".csv")) {
      // Simple CSV parsing
      const lines = content.split("\n");
      const headers = lines[0].split(",").map((h) => h.trim());
      data = lines.slice(1).filter((l) => l.trim()).map((line) => {
        const values = line.split(",");
        const item: Record<string, string> = {};
        headers.forEach((h, i) => (item[h] = values[i]?.trim() || ""));
        return this.parseDataItem(item, params.format);
      });
    } else {
      throw new Error(`Unsupported file format: ${params.filePath}`);
    }
    
    return this.createDataset({
      name: params.name,
      description: params.description,
      format: params.format,
      data,
    });
  }
  
  private parseDataItem(
    item: Record<string, unknown>,
    format: string
  ): { input: string; output: string; instruction?: string } {
    switch (format) {
      case "alpaca":
        return {
          instruction: String(item.instruction || ""),
          input: String(item.input || ""),
          output: String(item.output || ""),
        };
      case "sharegpt":
        const convs = item.conversations as Array<{ from: string; value: string }>;
        const human = convs?.find((c) => c.from === "human");
        const gpt = convs?.find((c) => c.from === "gpt" || c.from === "assistant");
        return {
          input: human?.value || "",
          output: gpt?.value || "",
        };
      case "oasst":
        return {
          input: String(item.INSTRUCTION || item.instruction || ""),
          output: String(item.RESPONSE || item.response || ""),
        };
      default:
        return {
          input: String(item.input || item.prompt || item.question || ""),
          output: String(item.output || item.response || item.answer || item.completion || ""),
          instruction: String(item.instruction || ""),
        };
    }
  }
  
  listDatasets(): TrainingDataset[] {
    return Array.from(this.datasets.values());
  }
  
  getDataset(id: string): TrainingDataset | null {
    return this.datasets.get(id) || null;
  }
  
  async deleteDataset(id: string): Promise<void> {
    const datasetDir = path.join(this.datasetsDir, id);
    if (existsSync(datasetDir)) {
      await fs.rm(datasetDir, { recursive: true, force: true });
    }
    this.datasets.delete(id);
    this.emit("dataset:deleted", { id });
  }
  
  // ===========================================================================
  // TRAINING JOBS
  // ===========================================================================
  
  async createTrainingJob(params: {
    name: string;
    baseModel: keyof typeof SUPPORTED_BASE_MODELS;
    baseModelPath: string;
    datasetId: string;
    method: "lora" | "qlora" | "full";
    config?: Partial<TrainingConfig>;
    metadata?: Record<string, unknown>;
  }): Promise<FineTuneJob> {
    const dataset = this.datasets.get(params.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${params.datasetId}`);
    }
    
    const baseModelInfo = SUPPORTED_BASE_MODELS[params.baseModel];
    if (!baseModelInfo) {
      throw new Error(`Unsupported base model: ${params.baseModel}`);
    }
    
    const id = crypto.randomUUID() as FineTuneJobId;
    const jobDir = path.join(this.fineTuningDir, "jobs", id);
    await fs.mkdir(jobDir, { recursive: true });
    
    // Get default config for method
    const defaultConfig = DEFAULT_TRAINING_CONFIGS[params.method];
    const config: TrainingConfig = {
      ...defaultConfig,
      ...params.config,
    } as TrainingConfig;
    
    const job: FineTuneJob = {
      id,
      name: params.name,
      baseModel: params.baseModel,
      baseModelPath: params.baseModelPath,
      datasetId: params.datasetId,
      method: params.method,
      config,
      status: "pending",
      progress: {
        currentStep: 0,
        totalSteps: Math.ceil(dataset.trainSamples / (config.batchSize || 4)) * (config.epochs || 3),
        currentEpoch: 0,
        totalEpochs: config.epochs || 3,
        loss: 0,
        learningRate: config.learningRate || 2e-4,
        elapsedTime: 0,
      },
      outputPath: jobDir,
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    this.jobs.set(id, job);
    await this.saveJobs();
    
    this.emit("job:created", job);
    
    return job;
  }
  
  async startTraining(jobId: FineTuneJobId): Promise<void> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    if (job.status === "running") {
      throw new Error("Job is already running");
    }
    
    const dataset = this.datasets.get(job.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${job.datasetId}`);
    }
    
    job.status = "running";
    job.startedAt = Date.now();
    job.updatedAt = Date.now();
    await this.saveJobs();
    
    this.emit("job:started", job);
    
    // Start training process
    try {
      await this.runTraining(job, dataset);
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      await this.saveJobs();
      this.emit("job:failed", { job, error: job.error });
    }
  }
  
  private async runTraining(job: FineTuneJob, dataset: TrainingDataset): Promise<void> {
    // Generate training script
    const scriptContent = this.generateTrainingScript(job, dataset);
    const scriptPath = path.join(job.outputPath, "train.py");
    await fs.writeFile(scriptPath, scriptContent);
    
    // Generate config file
    const configPath = path.join(job.outputPath, "config.json");
    await fs.writeFile(configPath, JSON.stringify(job.config, null, 2));
    
    const logPath = path.join(this.logsDir, `${job.id}.log`);
    const logStream = await fs.open(logPath, "a");
    
    logger.info("Starting training process", { jobId: job.id, script: scriptPath });
    
    // Check if Python is available
    const pythonCommand = process.platform === "win32" ? "python" : "python3";
    
    return new Promise((resolve, reject) => {
      const proc = spawn(pythonCommand, [scriptPath], {
        cwd: job.outputPath,
        env: {
          ...process.env,
          TRANSFORMERS_CACHE: path.join(this.fineTuningDir, "cache"),
          HF_HOME: path.join(this.fineTuningDir, "hf_home"),
        },
      });
      
      this.runningProcesses.set(job.id, proc);
      
      proc.stdout.on("data", async (data) => {
        const output = data.toString();
        await logStream.write(output);
        
        // Parse progress from output
        const progress = this.parseTrainingProgress(output);
        if (progress) {
          job.progress = { ...job.progress, ...progress };
          job.updatedAt = Date.now();
          this.emit("job:progress", { job, progress: job.progress });
        }
      });
      
      proc.stderr.on("data", async (data) => {
        await logStream.write(data.toString());
      });
      
      proc.on("error", async (error) => {
        await logStream.close();
        this.runningProcesses.delete(job.id);
        reject(error);
      });
      
      proc.on("close", async (code) => {
        await logStream.close();
        this.runningProcesses.delete(job.id);
        
        if (code === 0) {
          job.status = "completed";
          job.completedAt = Date.now();
          job.updatedAt = Date.now();
          
          // Create adapter entry
          await this.createAdapter(job);
          
          await this.saveJobs();
          this.emit("job:completed", job);
          resolve();
        } else {
          job.status = "failed";
          job.error = `Process exited with code ${code}`;
          job.completedAt = Date.now();
          job.updatedAt = Date.now();
          await this.saveJobs();
          reject(new Error(job.error));
        }
      });
    });
  }
  
  private generateTrainingScript(job: FineTuneJob, dataset: TrainingDataset): string {
    const config = job.config;
    
    if (job.method === "qlora") {
      return `
#!/usr/bin/env python3
"""
QLoRA Fine-tuning Script
Generated by JoyCreate Local Fine-tuning Service
Job: ${job.name} (${job.id})
"""

import os
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

# Configuration
MODEL_PATH = "${job.baseModelPath.replace(/\\/g, "/")}"
DATASET_PATH = "${dataset.path.replace(/\\/g, "/")}"
OUTPUT_DIR = "${job.outputPath.replace(/\\/g, "/")}"

# QLoRA config
LORA_R = ${config.loraR || 16}
LORA_ALPHA = ${config.loraAlpha || 32}
LORA_DROPOUT = ${config.loraDropout || 0.05}
TARGET_MODULES = ${JSON.stringify(config.targetModules || ["q_proj", "k_proj", "v_proj", "o_proj"])}

# Training config
BATCH_SIZE = ${config.batchSize || 2}
LEARNING_RATE = ${config.learningRate || 2e-4}
EPOCHS = ${config.epochs || 3}
WARMUP_STEPS = ${config.warmupSteps || 50}
MAX_GRAD_NORM = ${config.maxGradNorm || 0.3}
GRADIENT_ACCUMULATION = ${config.gradientAccumulationSteps || 8}

def main():
    print(f"[PROGRESS] status=initializing")
    
    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    
    # Quantization config
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_use_double_quant=${config.doublequant !== false},
        bnb_4bit_quant_type="${config.nf4 !== false ? "nf4" : "fp4"}",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    
    # Load model
    print(f"[PROGRESS] status=loading_model")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
    )
    model = prepare_model_for_kbit_training(model)
    
    # LoRA config
    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        bias="none",
        task_type="CAUSAL_LM",
    )
    
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Load dataset
    print(f"[PROGRESS] status=loading_dataset")
    dataset = load_dataset("json", data_files={
        "train": os.path.join(DATASET_PATH, "train.jsonl"),
        "validation": os.path.join(DATASET_PATH, "validation.jsonl"),
    })
    
    def tokenize(sample):
        if "instruction" in sample and sample["instruction"]:
            text = f"### Instruction:\\n{sample['instruction']}\\n\\n### Input:\\n{sample['input']}\\n\\n### Response:\\n{sample['output']}"
        else:
            text = f"### Input:\\n{sample['input']}\\n\\n### Response:\\n{sample['output']}"
        return tokenizer(text, truncation=True, max_length=2048, padding="max_length")
    
    tokenized_dataset = dataset.map(tokenize, remove_columns=dataset["train"].column_names)
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRADIENT_ACCUMULATION,
        learning_rate=LEARNING_RATE,
        warmup_steps=WARMUP_STEPS,
        max_grad_norm=MAX_GRAD_NORM,
        logging_steps=10,
        save_steps=100,
        evaluation_strategy="steps",
        eval_steps=100,
        fp16=True,
        optim="${config.optimizer || "paged_adamw_8bit"}",
        lr_scheduler_type="${config.scheduler || "cosine"}",
        report_to="none",
    )
    
    # Custom callback for progress
    class ProgressCallback(torch.utils.callbacks.Callback):
        def on_log(self, args, state, control, logs=None, **kwargs):
            if logs:
                print(f"[PROGRESS] step={state.global_step} epoch={state.epoch:.2f} loss={logs.get('loss', 0):.4f} lr={logs.get('learning_rate', 0):.2e}")
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset["train"],
        eval_dataset=tokenized_dataset["validation"],
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    
    # Train
    print(f"[PROGRESS] status=training")
    trainer.train()
    
    # Save
    print(f"[PROGRESS] status=saving")
    model.save_pretrained(os.path.join(OUTPUT_DIR, "adapter"))
    tokenizer.save_pretrained(os.path.join(OUTPUT_DIR, "adapter"))
    
    # Save adapter config
    adapter_config = {
        "id": "${job.id}",
        "name": "${job.name}",
        "baseModel": "${job.baseModel}",
        "method": "qlora",
        "loraR": LORA_R,
        "loraAlpha": LORA_ALPHA,
        "targetModules": TARGET_MODULES,
    }
    with open(os.path.join(OUTPUT_DIR, "adapter", "adapter_config.json"), "w") as f:
        json.dump(adapter_config, f, indent=2)
    
    print(f"[PROGRESS] status=completed")

if __name__ == "__main__":
    main()
`;
    } else if (job.method === "lora") {
      return `
#!/usr/bin/env python3
"""
LoRA Fine-tuning Script
Generated by JoyCreate Local Fine-tuning Service
Job: ${job.name} (${job.id})
"""

import os
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
)
from peft import LoraConfig, get_peft_model

# Configuration
MODEL_PATH = "${job.baseModelPath.replace(/\\/g, "/")}"
DATASET_PATH = "${dataset.path.replace(/\\/g, "/")}"
OUTPUT_DIR = "${job.outputPath.replace(/\\/g, "/")}"

# LoRA config
LORA_R = ${config.loraR || 8}
LORA_ALPHA = ${config.loraAlpha || 16}
LORA_DROPOUT = ${config.loraDropout || 0.05}
TARGET_MODULES = ${JSON.stringify(config.targetModules || ["q_proj", "v_proj"])}

# Training config
BATCH_SIZE = ${config.batchSize || 4}
LEARNING_RATE = ${config.learningRate || 2e-4}
EPOCHS = ${config.epochs || 3}
WARMUP_STEPS = ${config.warmupSteps || 100}

def main():
    print(f"[PROGRESS] status=initializing")
    
    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    
    print(f"[PROGRESS] status=loading_model")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        device_map="auto",
        trust_remote_code=True,
    )
    
    # LoRA config
    lora_config = LoraConfig(
        r=LORA_R,
        lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT,
        target_modules=TARGET_MODULES,
        bias="none",
        task_type="CAUSAL_LM",
    )
    
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    
    # Load dataset
    print(f"[PROGRESS] status=loading_dataset")
    dataset = load_dataset("json", data_files={
        "train": os.path.join(DATASET_PATH, "train.jsonl"),
        "validation": os.path.join(DATASET_PATH, "validation.jsonl"),
    })
    
    def tokenize(sample):
        if "instruction" in sample and sample["instruction"]:
            text = f"### Instruction:\\n{sample['instruction']}\\n\\n### Input:\\n{sample['input']}\\n\\n### Response:\\n{sample['output']}"
        else:
            text = f"### Input:\\n{sample['input']}\\n\\n### Response:\\n{sample['output']}"
        return tokenizer(text, truncation=True, max_length=2048, padding="max_length")
    
    tokenized_dataset = dataset.map(tokenize, remove_columns=dataset["train"].column_names)
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=${config.gradientAccumulationSteps || 4},
        learning_rate=LEARNING_RATE,
        warmup_steps=WARMUP_STEPS,
        max_grad_norm=${config.maxGradNorm || 0.3},
        logging_steps=10,
        save_steps=100,
        evaluation_strategy="steps",
        eval_steps=100,
        fp16=True,
        optim="${config.optimizer || "adamw_torch"}",
        lr_scheduler_type="${config.scheduler || "cosine"}",
        report_to="none",
    )
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset["train"],
        eval_dataset=tokenized_dataset["validation"],
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    
    # Train
    print(f"[PROGRESS] status=training")
    trainer.train()
    
    # Save
    print(f"[PROGRESS] status=saving")
    model.save_pretrained(os.path.join(OUTPUT_DIR, "adapter"))
    tokenizer.save_pretrained(os.path.join(OUTPUT_DIR, "adapter"))
    
    print(f"[PROGRESS] status=completed")

if __name__ == "__main__":
    main()
`;
    } else {
      // Full fine-tuning
      return `
#!/usr/bin/env python3
"""
Full Fine-tuning Script
Generated by JoyCreate Local Fine-tuning Service
Job: ${job.name} (${job.id})
"""

import os
import json
import torch
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    Trainer,
    DataCollatorForLanguageModeling,
)

# Configuration
MODEL_PATH = "${job.baseModelPath.replace(/\\/g, "/")}"
DATASET_PATH = "${dataset.path.replace(/\\/g, "/")}"
OUTPUT_DIR = "${job.outputPath.replace(/\\/g, "/")}"

def main():
    print(f"[PROGRESS] status=initializing")
    
    # Load tokenizer and model
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    
    print(f"[PROGRESS] status=loading_model")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )
    
    # Load dataset
    print(f"[PROGRESS] status=loading_dataset")
    dataset = load_dataset("json", data_files={
        "train": os.path.join(DATASET_PATH, "train.jsonl"),
        "validation": os.path.join(DATASET_PATH, "validation.jsonl"),
    })
    
    def tokenize(sample):
        text = f"### Input:\\n{sample['input']}\\n\\n### Response:\\n{sample['output']}"
        return tokenizer(text, truncation=True, max_length=2048, padding="max_length")
    
    tokenized_dataset = dataset.map(tokenize, remove_columns=dataset["train"].column_names)
    
    # Training arguments
    training_args = TrainingArguments(
        output_dir=OUTPUT_DIR,
        num_train_epochs=${config.epochs || 1},
        per_device_train_batch_size=${config.batchSize || 1},
        gradient_accumulation_steps=${config.gradientAccumulationSteps || 16},
        learning_rate=${config.learningRate || 1e-5},
        warmup_steps=${config.warmupSteps || 100},
        logging_steps=10,
        save_steps=100,
        evaluation_strategy="steps",
        eval_steps=100,
        bf16=True,
        optim="${config.optimizer || "adamw_torch"}",
        lr_scheduler_type="${config.scheduler || "linear"}",
        report_to="none",
    )
    
    # Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset["train"],
        eval_dataset=tokenized_dataset["validation"],
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
    )
    
    # Train
    print(f"[PROGRESS] status=training")
    trainer.train()
    
    # Save
    print(f"[PROGRESS] status=saving")
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)
    
    print(f"[PROGRESS] status=completed")

if __name__ == "__main__":
    main()
`;
    }
  }
  
  private parseTrainingProgress(output: string): Partial<TrainingProgress> | null {
    const progressMatch = output.match(/\[PROGRESS\]\s+(.+)/);
    if (!progressMatch) return null;
    
    const params: Record<string, string | number> = {};
    const parts = progressMatch[1].split(/\s+/);
    
    for (const part of parts) {
      const [key, value] = part.split("=");
      if (key && value) {
        params[key] = isNaN(Number(value)) ? value : Number(value);
      }
    }
    
    const progress: Partial<TrainingProgress> = {};
    
    if (params.step !== undefined) progress.currentStep = Number(params.step);
    if (params.epoch !== undefined) progress.currentEpoch = Number(params.epoch);
    if (params.loss !== undefined) progress.loss = Number(params.loss);
    if (params.lr !== undefined) progress.learningRate = Number(params.lr);
    
    return Object.keys(progress).length > 0 ? progress : null;
  }
  
  private async createAdapter(job: FineTuneJob): Promise<ModelAdapter> {
    const adapterPath = path.join(job.outputPath, "adapter");
    
    const adapter: ModelAdapter = {
      id: job.id,
      name: job.name,
      baseModel: job.baseModel,
      method: job.method,
      path: adapterPath,
      config: job.config,
      jobId: job.id,
      createdAt: Date.now(),
    };
    
    // Copy adapter to adapters directory
    const destPath = path.join(this.adaptersDir, job.id);
    await fs.cp(adapterPath, destPath, { recursive: true });
    adapter.path = destPath;
    
    this.adapters.set(job.id, adapter);
    
    return adapter;
  }
  
  async stopTraining(jobId: FineTuneJobId): Promise<void> {
    const proc = this.runningProcesses.get(jobId);
    if (proc) {
      proc.kill("SIGTERM");
      this.runningProcesses.delete(jobId);
    }
    
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = "cancelled";
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      await this.saveJobs();
      this.emit("job:cancelled", job);
    }
  }
  
  listJobs(): FineTuneJob[] {
    return Array.from(this.jobs.values());
  }
  
  getJob(id: FineTuneJobId): FineTuneJob | null {
    return this.jobs.get(id) || null;
  }
  
  async deleteJob(id: FineTuneJobId): Promise<void> {
    const job = this.jobs.get(id);
    if (job) {
      // Stop if running
      await this.stopTraining(id);
      
      // Delete job files
      if (existsSync(job.outputPath)) {
        await fs.rm(job.outputPath, { recursive: true, force: true });
      }
    }
    
    this.jobs.delete(id);
    await this.saveJobs();
    this.emit("job:deleted", { id });
  }
  
  // ===========================================================================
  // ADAPTERS
  // ===========================================================================
  
  listAdapters(): ModelAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  getAdapter(id: string): ModelAdapter | null {
    return this.adapters.get(id) || null;
  }
  
  async deleteAdapter(id: string): Promise<void> {
    const adapter = this.adapters.get(id);
    if (adapter && existsSync(adapter.path)) {
      await fs.rm(adapter.path, { recursive: true, force: true });
    }
    this.adapters.delete(id);
    this.emit("adapter:deleted", { id });
  }
  
  async mergeAdapter(adapterId: string, outputPath: string): Promise<string> {
    const adapter = this.adapters.get(adapterId);
    if (!adapter) {
      throw new Error(`Adapter not found: ${adapterId}`);
    }
    
    // Generate merge script
    const scriptContent = `
#!/usr/bin/env python3
"""
Adapter Merge Script
Merges LoRA adapter with base model
"""

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE_MODEL = "${adapter.baseModel}"
ADAPTER_PATH = "${adapter.path.replace(/\\/g, "/")}"
OUTPUT_PATH = "${outputPath.replace(/\\/g, "/")}"

def main():
    print("Loading base model...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map="auto",
    )
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
    
    print("Loading adapter...")
    model = PeftModel.from_pretrained(model, ADAPTER_PATH)
    
    print("Merging...")
    model = model.merge_and_unload()
    
    print("Saving merged model...")
    model.save_pretrained(OUTPUT_PATH)
    tokenizer.save_pretrained(OUTPUT_PATH)
    
    print("Done!")

if __name__ == "__main__":
    main()
`;
    
    const scriptPath = path.join(this.fineTuningDir, "merge_temp.py");
    await fs.writeFile(scriptPath, scriptContent);
    
    // Run merge script
    return new Promise((resolve, reject) => {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCommand, [scriptPath]);
      
      proc.on("close", async (code) => {
        await fs.unlink(scriptPath).catch(() => {});
        
        if (code === 0) {
          resolve(outputPath);
        } else {
          reject(new Error(`Merge failed with code ${code}`));
        }
      });
      
      proc.on("error", async (error) => {
        await fs.unlink(scriptPath).catch(() => {});
        reject(error);
      });
    });
  }
  
  // ===========================================================================
  // EVALUATION
  // ===========================================================================
  
  async evaluateModel(params: {
    modelPath: string;
    adapterId?: string;
    datasetId: string;
    metrics?: ("perplexity" | "bleu" | "rouge" | "accuracy")[];
  }): Promise<EvaluationResult> {
    const dataset = this.datasets.get(params.datasetId);
    if (!dataset) {
      throw new Error(`Dataset not found: ${params.datasetId}`);
    }
    
    const evalId = crypto.randomUUID();
    const evalDir = path.join(this.fineTuningDir, "evaluations", evalId);
    await fs.mkdir(evalDir, { recursive: true });
    
    // Generate evaluation script
    const metrics = params.metrics || ["perplexity"];
    const scriptContent = `
#!/usr/bin/env python3
"""
Model Evaluation Script
"""

import json
import math
import torch
from datasets import load_dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
${params.adapterId ? "from peft import PeftModel" : ""}

MODEL_PATH = "${params.modelPath.replace(/\\/g, "/")}"
${params.adapterId ? `ADAPTER_PATH = "${this.adapters.get(params.adapterId)?.path.replace(/\\/g, "/")}"` : ""}
DATASET_PATH = "${dataset.path.replace(/\\/g, "/")}"
OUTPUT_PATH = "${evalDir.replace(/\\/g, "/")}"

def calculate_perplexity(model, tokenizer, texts):
    model.eval()
    total_loss = 0
    total_tokens = 0
    
    with torch.no_grad():
        for text in texts:
            inputs = tokenizer(text, return_tensors="pt", truncation=True, max_length=2048)
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
            
            outputs = model(**inputs, labels=inputs["input_ids"])
            total_loss += outputs.loss.item() * inputs["input_ids"].size(1)
            total_tokens += inputs["input_ids"].size(1)
    
    return math.exp(total_loss / total_tokens)

def main():
    print("Loading model...")
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_PATH,
        torch_dtype=torch.float16,
        device_map="auto",
    )
    tokenizer = AutoTokenizer.from_pretrained(MODEL_PATH)
    
    ${params.adapterId ? `
    print("Loading adapter...")
    model = PeftModel.from_pretrained(model, ADAPTER_PATH)
    ` : ""}
    
    print("Loading dataset...")
    dataset = load_dataset("json", data_files={"test": DATASET_PATH + "/validation.jsonl"})
    texts = [f"{sample['input']} {sample['output']}" for sample in dataset["test"]]
    
    results = {}
    
    ${metrics.includes("perplexity") ? `
    print("Calculating perplexity...")
    results["perplexity"] = calculate_perplexity(model, tokenizer, texts[:100])
    ` : ""}
    
    # Save results
    with open(OUTPUT_PATH + "/results.json", "w") as f:
        json.dump(results, f, indent=2)
    
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
`;
    
    const scriptPath = path.join(evalDir, "evaluate.py");
    await fs.writeFile(scriptPath, scriptContent);
    
    return new Promise((resolve, reject) => {
      const pythonCommand = process.platform === "win32" ? "python" : "python3";
      const proc = spawn(pythonCommand, [scriptPath]);
      
      let output = "";
      proc.stdout.on("data", (data) => {
        output += data.toString();
      });
      
      proc.on("close", async (code) => {
        if (code === 0) {
          try {
            const resultsPath = path.join(evalDir, "results.json");
            const results = JSON.parse(await fs.readFile(resultsPath, "utf-8"));
            
            const evalResult: EvaluationResult = {
              id: evalId,
              modelPath: params.modelPath,
              adapterId: params.adapterId,
              datasetId: params.datasetId,
              metrics: results,
              completedAt: Date.now(),
            };
            
            resolve(evalResult);
          } catch (error) {
            reject(error);
          }
        } else {
          reject(new Error(`Evaluation failed with code ${code}`));
        }
      });
      
      proc.on("error", reject);
    });
  }
  
  // ===========================================================================
  // UTILITIES
  // ===========================================================================
  
  getSupportedBaseModels(): typeof SUPPORTED_BASE_MODELS {
    return SUPPORTED_BASE_MODELS;
  }
  
  getDefaultConfigs(): typeof DEFAULT_TRAINING_CONFIGS {
    return DEFAULT_TRAINING_CONFIGS;
  }
  
  async estimateTrainingTime(params: {
    datasetSize: number;
    epochs: number;
    batchSize: number;
    method: "lora" | "qlora" | "full";
  }): Promise<{ estimatedMinutes: number; estimatedGPUMemoryGB: number }> {
    // Rough estimates based on method
    const baseTimePerSample = {
      lora: 0.5, // seconds
      qlora: 0.8,
      full: 2.0,
    };
    
    const memoryUsage = {
      lora: 12,
      qlora: 8,
      full: 24,
    };
    
    const totalSteps = Math.ceil(params.datasetSize / params.batchSize) * params.epochs;
    const estimatedSeconds = totalSteps * baseTimePerSample[params.method];
    
    return {
      estimatedMinutes: Math.ceil(estimatedSeconds / 60),
      estimatedGPUMemoryGB: memoryUsage[params.method],
    };
  }
  
  async shutdown(): Promise<void> {
    // Stop all running jobs
    for (const [jobId, proc] of this.runningProcesses) {
      proc.kill("SIGTERM");
      this.runningProcesses.delete(jobId);
    }
    
    await this.saveJobs();
  }
}

// Export singleton
export const localFineTuning = new LocalFineTuning();
