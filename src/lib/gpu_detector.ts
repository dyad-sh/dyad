/**
 * GPU Detector — Cross-platform GPU detection for model recommendations
 *
 * Detects:
 *   - NVIDIA GPUs (via nvidia-smi)
 *   - AMD GPUs (via wmic on Windows, lspci on Linux)
 *   - Apple Silicon (via system_profiler on macOS)
 *   - Intel GPUs (by exclusion / wmic)
 *   - System RAM for CPU-only inference sizing
 *
 * Returns structured info used by the Model Download Manager to recommend
 * appropriate model sizes and quantizations.
 */

import { execSync } from "child_process";
import * as os from "os";
import log from "electron-log";

const logger = log.scope("gpu_detector");

// =============================================================================
// TYPES
// =============================================================================

export interface DetectedGPU {
  vendor: "nvidia" | "amd" | "intel" | "apple" | "unknown";
  name: string;
  vramMB: number;
  driverVersion?: string;
  cudaVersion?: string;
  metalSupport?: boolean;
  computeCapability?: string;
}

export interface SystemHardwareInfo {
  platform: NodeJS.Platform;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  totalRAM_MB: number;
  freeRAM_MB: number;
  gpus: DetectedGPU[];
  hasGPU: boolean;
  bestGPU: DetectedGPU | null;
  recommendedQuantization: string;
  maxModelSizeGB: number;
}

// =============================================================================
// DETECTION
// =============================================================================

/**
 * Detect all available GPUs and system hardware
 */
export async function detectSystemHardware(): Promise<SystemHardwareInfo> {
  const platform = os.platform();
  const gpus: DetectedGPU[] = [];

  // Detect NVIDIA GPUs (all platforms)
  try {
    const nvidiaGPUs = detectNvidiaGPUs();
    gpus.push(...nvidiaGPUs);
  } catch {
    // nvidia-smi not available
  }

  // Platform-specific detection
  if (platform === "win32") {
    try {
      const wmicGPUs = detectWindowsGPUs();
      // Add non-NVIDIA GPUs (avoid duplicates)
      for (const gpu of wmicGPUs) {
        if (gpu.vendor !== "nvidia" && !gpus.some((g) => g.name === gpu.name)) {
          gpus.push(gpu);
        }
      }
    } catch {
      // wmic not available
    }
  } else if (platform === "darwin") {
    try {
      const appleGPUs = detectMacGPUs();
      gpus.push(...appleGPUs);
    } catch {
      // system_profiler failed
    }
  } else if (platform === "linux") {
    try {
      const linuxGPUs = detectLinuxGPUs();
      for (const gpu of linuxGPUs) {
        if (!gpus.some((g) => g.name === gpu.name)) {
          gpus.push(gpu);
        }
      }
    } catch {
      // lspci not available
    }
  }

  const totalRAM_MB = Math.round(os.totalmem() / (1024 * 1024));
  const freeRAM_MB = Math.round(os.freemem() / (1024 * 1024));
  const cpus = os.cpus();

  const bestGPU =
    gpus.length > 0
      ? gpus.reduce((best, gpu) => (gpu.vramMB > best.vramMB ? gpu : best))
      : null;

  const { quantization, maxModelSizeGB } = recommendModelConfig(
    bestGPU,
    totalRAM_MB,
  );

  const info: SystemHardwareInfo = {
    platform,
    arch: os.arch(),
    cpuModel: cpus[0]?.model ?? "Unknown",
    cpuCores: cpus.length,
    totalRAM_MB: totalRAM_MB,
    freeRAM_MB: freeRAM_MB,
    gpus,
    hasGPU: gpus.length > 0,
    bestGPU,
    recommendedQuantization: quantization,
    maxModelSizeGB,
  };

  logger.info("System hardware detected", {
    gpuCount: gpus.length,
    bestGPU: bestGPU?.name,
    vram: bestGPU?.vramMB,
    ram: totalRAM_MB,
    quantization,
    maxModelSize: maxModelSizeGB,
  });

  return info;
}

// =============================================================================
// NVIDIA DETECTION
// =============================================================================

function detectNvidiaGPUs(): DetectedGPU[] {
  const gpus: DetectedGPU[] = [];

  const output = execSync(
    "nvidia-smi --query-gpu=name,memory.total,driver_version,compute_cap --format=csv,noheader,nounits",
    { encoding: "utf-8", timeout: 5000 },
  ).trim();

  if (!output) return gpus;

  // Check CUDA version
  let cudaVersion: string | undefined;
  try {
    const nvccOutput = execSync("nvcc --version", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const cudaMatch = nvccOutput.match(/release (\d+\.\d+)/);
    if (cudaMatch) cudaVersion = cudaMatch[1];
  } catch {
    // Try nvidia-smi for CUDA version
    try {
      const smiOutput = execSync("nvidia-smi", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const cudaMatch = smiOutput.match(/CUDA Version:\s*(\d+\.\d+)/);
      if (cudaMatch) cudaVersion = cudaMatch[1];
    } catch {
      // No CUDA info available
    }
  }

  for (const line of output.split("\n")) {
    const parts = line.split(",").map((p) => p.trim());
    if (parts.length >= 2) {
      gpus.push({
        vendor: "nvidia",
        name: parts[0],
        vramMB: parseInt(parts[1], 10) || 0,
        driverVersion: parts[2] || undefined,
        cudaVersion,
        computeCapability: parts[3] || undefined,
      });
    }
  }

  return gpus;
}

// =============================================================================
// WINDOWS DETECTION (AMD / Intel via WMIC)
// =============================================================================

function detectWindowsGPUs(): DetectedGPU[] {
  const gpus: DetectedGPU[] = [];

  // Try PowerShell first (more reliable than wmic)
  try {
    const output = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM, DriverVersion | ConvertTo-Csv -NoTypeInformation"',
      { encoding: "utf-8", timeout: 10000 },
    ).trim();

    const lines = output.split("\n").slice(1); // Skip header
    for (const line of lines) {
      const match = line.match(/"([^"]*)",?"?(\d*)"?,?"?([^"]*)"?/);
      if (match) {
        const name = match[1];
        const adapterRAM = parseInt(match[2], 10) || 0;
        const driverVersion = match[3];
        const vramMB = Math.round(adapterRAM / (1024 * 1024));
        const vendor = detectVendorFromName(name);

        gpus.push({
          vendor,
          name,
          vramMB: vramMB > 0 ? vramMB : 0,
          driverVersion: driverVersion || undefined,
        });
      }
    }
  } catch {
    // Fallback to wmic
    try {
      const output = execSync(
        "wmic path win32_VideoController get Name,AdapterRAM,DriverVersion /format:csv",
        { encoding: "utf-8", timeout: 10000 },
      ).trim();

      for (const line of output.split("\n").slice(1)) {
        const parts = line.split(",");
        if (parts.length >= 4) {
          const adapterRAM = parseInt(parts[1], 10) || 0;
          const name = parts[3]?.trim() ?? "";
          const vramMB = Math.round(adapterRAM / (1024 * 1024));
          const vendor = detectVendorFromName(name);

          if (name) {
            gpus.push({ vendor, name, vramMB, driverVersion: parts[2] });
          }
        }
      }
    } catch {
      // wmic also failed
    }
  }

  return gpus;
}

// =============================================================================
// macOS DETECTION (Apple Silicon / AMD dGPU)
// =============================================================================

function detectMacGPUs(): DetectedGPU[] {
  const gpus: DetectedGPU[] = [];

  const output = execSync(
    "system_profiler SPDisplaysDataType -json",
    { encoding: "utf-8", timeout: 10000 },
  );

  try {
    const data = JSON.parse(output);
    const displays = data.SPDisplaysDataType || [];

    for (const display of displays) {
      const name = display.sppci_model || "Unknown GPU";
      const vendor = detectVendorFromName(name);

      // Apple Silicon reports unified memory
      let vramMB = 0;
      const vramStr =
        display.spdisplays_vram || display.sppci_vram || "";
      if (vramStr) {
        const match = vramStr.match(/(\d+)\s*(MB|GB)/i);
        if (match) {
          vramMB =
            match[2].toUpperCase() === "GB"
              ? parseInt(match[1], 10) * 1024
              : parseInt(match[1], 10);
        }
      }

      // For Apple Silicon, unified memory is shared — use total RAM as VRAM proxy
      const isAppleSilicon =
        name.includes("Apple") || os.arch() === "arm64";
      if (isAppleSilicon && vramMB === 0) {
        vramMB = Math.round(os.totalmem() / (1024 * 1024));
      }

      gpus.push({
        vendor: isAppleSilicon ? "apple" : vendor,
        name,
        vramMB,
        metalSupport: true, // All modern Macs support Metal
      });
    }
  } catch {
    // JSON parse failed — try plain text
    if (os.arch() === "arm64") {
      gpus.push({
        vendor: "apple",
        name: "Apple Silicon GPU",
        vramMB: Math.round(os.totalmem() / (1024 * 1024)),
        metalSupport: true,
      });
    }
  }

  return gpus;
}

// =============================================================================
// LINUX DETECTION (AMD / Intel via lspci)
// =============================================================================

function detectLinuxGPUs(): DetectedGPU[] {
  const gpus: DetectedGPU[] = [];

  try {
    const output = execSync('lspci | grep -i "vga\\|3d\\|display"', {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const name = line.replace(/^[0-9a-f:. ]+/i, "").trim();
      const vendor = detectVendorFromName(name);

      // VRAM is hard to get on Linux without vendor tools
      // We report 0 and let the recommendation system use RAM
      gpus.push({ vendor, name, vramMB: 0 });
    }
  } catch {
    // lspci not available
  }

  return gpus;
}

// =============================================================================
// HELPERS
// =============================================================================

function detectVendorFromName(
  name: string,
): "nvidia" | "amd" | "intel" | "apple" | "unknown" {
  const lower = name.toLowerCase();
  if (lower.includes("nvidia") || lower.includes("geforce") || lower.includes("quadro") || lower.includes("rtx") || lower.includes("gtx")) {
    return "nvidia";
  }
  if (lower.includes("amd") || lower.includes("radeon") || lower.includes("rx ")) {
    return "amd";
  }
  if (lower.includes("intel") || lower.includes("iris") || lower.includes("uhd") || lower.includes("hd graphics")) {
    return "intel";
  }
  if (lower.includes("apple") || lower.includes("m1") || lower.includes("m2") || lower.includes("m3") || lower.includes("m4")) {
    return "apple";
  }
  return "unknown";
}

/**
 * Recommend quantization and max model size based on hardware
 */
function recommendModelConfig(
  bestGPU: DetectedGPU | null,
  totalRAM_MB: number,
): { quantization: string; maxModelSizeGB: number } {
  const vram = bestGPU?.vramMB ?? 0;

  // GPU-based recommendations
  if (vram >= 24_000) {
    return { quantization: "Q8_0", maxModelSizeGB: 30 };
  }
  if (vram >= 16_000) {
    return { quantization: "Q6_K", maxModelSizeGB: 14 };
  }
  if (vram >= 12_000) {
    return { quantization: "Q5_K_M", maxModelSizeGB: 10 };
  }
  if (vram >= 8_000) {
    return { quantization: "Q4_K_M", maxModelSizeGB: 7 };
  }
  if (vram >= 6_000) {
    return { quantization: "Q4_K_S", maxModelSizeGB: 4 };
  }
  if (vram >= 4_000) {
    return { quantization: "Q3_K_M", maxModelSizeGB: 3 };
  }

  // CPU-only (Apple Silicon unified memory also falls through when VRAM == total RAM)
  if (bestGPU?.vendor === "apple") {
    // Apple Silicon can use up to ~75% of unified memory for ML
    const effectiveVRAM = totalRAM_MB * 0.75;
    if (effectiveVRAM >= 24_000) return { quantization: "Q6_K", maxModelSizeGB: 20 };
    if (effectiveVRAM >= 16_000) return { quantization: "Q5_K_M", maxModelSizeGB: 13 };
    if (effectiveVRAM >= 8_000) return { quantization: "Q4_K_M", maxModelSizeGB: 7 };
    return { quantization: "Q4_K_S", maxModelSizeGB: 3 };
  }

  // Pure CPU inference based on RAM
  if (totalRAM_MB >= 32_000) return { quantization: "Q4_K_M", maxModelSizeGB: 7 };
  if (totalRAM_MB >= 16_000) return { quantization: "Q4_K_S", maxModelSizeGB: 4 };
  if (totalRAM_MB >= 8_000) return { quantization: "Q3_K_M", maxModelSizeGB: 2 };
  return { quantization: "Q2_K", maxModelSizeGB: 1 };
}

// =============================================================================
// MODEL CATALOG — Recommended models by use case
// =============================================================================

export interface CatalogModel {
  id: string;
  name: string;
  description: string;
  category: "chat" | "code" | "embedding" | "vision" | "small";
  source: "ollama";
  // Size thresholds (approximate GGUF sizes in GB)
  sizes: Array<{
    variant: string;
    sizeGB: number;
    minVRAM_MB: number;
  }>;
  defaultVariant: string;
  recommended?: boolean;
}

export const MODEL_CATALOG: CatalogModel[] = [
  // Chat models
  {
    id: "llama3.2:latest",
    name: "Llama 3.2 (3B)",
    description: "Meta's latest small chat model — fast, capable, great for local use",
    category: "chat",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 2.0, minVRAM_MB: 4000 }],
    defaultVariant: "latest",
    recommended: true,
  },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1 (8B)",
    description: "Meta's powerful 8B model — excellent balance of speed and quality",
    category: "chat",
    source: "ollama",
    sizes: [
      { variant: "8b", sizeGB: 4.7, minVRAM_MB: 6000 },
      { variant: "8b-q4_0", sizeGB: 4.0, minVRAM_MB: 5000 },
    ],
    defaultVariant: "8b",
  },
  {
    id: "mistral:latest",
    name: "Mistral 7B",
    description: "Efficient 7B model with strong reasoning capabilities",
    category: "chat",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 4.1, minVRAM_MB: 5000 }],
    defaultVariant: "latest",
  },
  {
    id: "gemma2:9b",
    name: "Gemma 2 (9B)",
    description: "Google's lightweight model — great quality for its size",
    category: "chat",
    source: "ollama",
    sizes: [{ variant: "9b", sizeGB: 5.4, minVRAM_MB: 7000 }],
    defaultVariant: "9b",
  },
  {
    id: "qwen2.5:7b",
    name: "Qwen 2.5 (7B)",
    description: "Strong multilingual model from Alibaba",
    category: "chat",
    source: "ollama",
    sizes: [{ variant: "7b", sizeGB: 4.4, minVRAM_MB: 6000 }],
    defaultVariant: "7b",
  },
  // Code models
  {
    id: "qwen2.5-coder:7b",
    name: "Qwen 2.5 Coder (7B)",
    description: "Top-tier open code model — state of the art for its size",
    category: "code",
    source: "ollama",
    sizes: [{ variant: "7b", sizeGB: 4.4, minVRAM_MB: 6000 }],
    defaultVariant: "7b",
    recommended: true,
  },
  {
    id: "deepseek-coder-v2:16b",
    name: "DeepSeek Coder V2 (16B)",
    description: "Excellent code generation and understanding",
    category: "code",
    source: "ollama",
    sizes: [{ variant: "16b", sizeGB: 8.9, minVRAM_MB: 12000 }],
    defaultVariant: "16b",
  },
  {
    id: "codellama:7b",
    name: "Code Llama (7B)",
    description: "Meta's coding model — good for code completion",
    category: "code",
    source: "ollama",
    sizes: [{ variant: "7b", sizeGB: 3.8, minVRAM_MB: 5000 }],
    defaultVariant: "7b",
  },
  // Embedding models
  {
    id: "nomic-embed-text:latest",
    name: "Nomic Embed Text",
    description: "Best open embedding model — 768d, 8192 token context",
    category: "embedding",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 0.27, minVRAM_MB: 1000 }],
    defaultVariant: "latest",
    recommended: true,
  },
  {
    id: "all-minilm:latest",
    name: "All-MiniLM-L6-v2",
    description: "Lightweight 384d embedding model — fast on CPU",
    category: "embedding",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 0.05, minVRAM_MB: 500 }],
    defaultVariant: "latest",
  },
  {
    id: "mxbai-embed-large:latest",
    name: "MxBAI Embed Large",
    description: "High-quality 1024d embeddings",
    category: "embedding",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 0.67, minVRAM_MB: 2000 }],
    defaultVariant: "latest",
  },
  // Vision models
  {
    id: "llava:7b",
    name: "LLaVA (7B)",
    description: "Multi-modal vision + language model",
    category: "vision",
    source: "ollama",
    sizes: [{ variant: "7b", sizeGB: 4.5, minVRAM_MB: 6000 }],
    defaultVariant: "7b",
  },
  // Small / edge models
  {
    id: "phi3:mini",
    name: "Phi-3 Mini (3.8B)",
    description: "Microsoft's compact model — great for limited hardware",
    category: "small",
    source: "ollama",
    sizes: [{ variant: "mini", sizeGB: 2.3, minVRAM_MB: 3000 }],
    defaultVariant: "mini",
    recommended: true,
  },
  {
    id: "tinyllama:latest",
    name: "TinyLlama (1.1B)",
    description: "Ultra-small model — runs on almost anything",
    category: "small",
    source: "ollama",
    sizes: [{ variant: "latest", sizeGB: 0.64, minVRAM_MB: 1000 }],
    defaultVariant: "latest",
  },
];
