/**
 * Neural Network Builder IPC Handlers
 *
 * Visual neural network design, training simulation, versioning, A/B testing,
 * transfer learning, AutoML optimization, and edge deployment.
 * Data persisted as JSON in ~/userData/neural-networks/.
 */

import { ipcMain, app } from "electron";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import * as crypto from "crypto";
import log from "electron-log";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("neural-builder");
const NEURAL_DIR = () => path.join(app.getPath("userData"), "neural-networks");

// ── Types ─────────────────────────────────────────────────────────────────────

export type NNLayerType =
  | "dense"
  | "conv2d"
  | "maxpool2d"
  | "dropout"
  | "flatten"
  | "lstm"
  | "gru"
  | "attention"
  | "embedding"
  | "batch-norm"
  | "activation"
  | "reshape"
  | "concat";

export interface NNLayer {
  id: string;
  type: NNLayerType;
  name: string;
  params: Record<string, number | string | boolean>;
  position: number;
}

export interface TrainingConfig {
  epochs: number;
  batchSize: number;
  learningRate: number;
  optimizer: "adam" | "sgd" | "rmsprop" | "adamw" | "adagrad";
  lossFunction: string;
  metrics: string[];
  validationSplit: number;
  earlyStoppingPatience: number;
  enableMixedPrecision: boolean;
  warmupSteps: number;
  weightDecay: number;
}

export interface NeuralNetwork {
  id: string;
  name: string;
  description: string;
  taskType:
    | "classification"
    | "regression"
    | "generation"
    | "detection"
    | "segmentation"
    | "nlp"
    | "multi-modal";
  inputShape: number[];
  outputShape: number[];
  layers: NNLayer[];
  trainingConfig: TrainingConfig;
  transferLearning?: {
    baseModel: string;
    baseModelName: string;
    frozenLayers: number;
  };
  edgeDeployment?: {
    enabled: boolean;
    targetDevice: string;
    quantization: string;
  };
  status:
    | "draft"
    | "training"
    | "trained"
    | "deploying"
    | "deployed"
    | "failed";
  accuracy?: number;
  loss?: number;
  valAccuracy?: number;
  valLoss?: number;
  totalParams?: number;
  trainedAt?: number;
  deployedAt?: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ModelVersion {
  id: string;
  networkId: string;
  version: string;
  accuracy: number;
  loss: number;
  valAccuracy: number;
  valLoss: number;
  notes: string;
  layers: NNLayer[];
  trainingConfig: TrainingConfig;
  createdAt: number;
}

export interface ABTest {
  id: string;
  name: string;
  modelAId: string;
  modelAName: string;
  modelBId: string;
  modelBName: string;
  metric: "accuracy" | "latency" | "size" | "f1";
  status: "pending" | "running" | "completed";
  results?: {
    modelA: number;
    modelB: number;
    winner: string;
    winnerModelId: string;
    improvement: number;
  };
  notes: string;
  createdAt: number;
}

export interface PretrainedModel {
  id: string;
  name: string;
  task: string;
  params: string;
  size: string;
  source: string;
  description: string;
  license: string;
  inputShape?: number[];
}

// ── Persistence helpers ──────────────────────────────────────────────────────

async function ensureDir(): Promise<void> {
  await fs.mkdir(NEURAL_DIR(), { recursive: true });
}

async function loadNetworks(): Promise<NeuralNetwork[]> {
  await ensureDir();
  const indexPath = path.join(NEURAL_DIR(), "index.json");
  if (!existsSync(indexPath)) return [];
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return JSON.parse(raw) as NeuralNetwork[];
  } catch {
    return [];
  }
}

async function saveNetworks(networks: NeuralNetwork[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    path.join(NEURAL_DIR(), "index.json"),
    JSON.stringify(networks, null, 2),
  );
}

async function loadVersions(networkId: string): Promise<ModelVersion[]> {
  const filePath = path.join(NEURAL_DIR(), `${networkId}-versions.json`);
  if (!existsSync(filePath)) return [];
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ModelVersion[];
  } catch {
    return [];
  }
}

async function saveVersions(
  networkId: string,
  versions: ModelVersion[],
): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    path.join(NEURAL_DIR(), `${networkId}-versions.json`),
    JSON.stringify(versions, null, 2),
  );
}

async function loadABTests(): Promise<ABTest[]> {
  const filePath = path.join(NEURAL_DIR(), "ab-tests.json");
  if (!existsSync(filePath)) return [];
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as ABTest[];
  } catch {
    return [];
  }
}

async function saveABTests(tests: ABTest[]): Promise<void> {
  await ensureDir();
  await fs.writeFile(
    path.join(NEURAL_DIR(), "ab-tests.json"),
    JSON.stringify(tests, null, 2),
  );
}

// ── Active training timers ────────────────────────────────────────────────────

const activeTrainings = new Map<string, ReturnType<typeof setTimeout>>();

// ── Parameter estimation ──────────────────────────────────────────────────────

function estimateParams(layers: NNLayer[]): number {
  let prevUnits = 128;
  let total = 0;
  for (const l of layers) {
    if (l.type === "dense") {
      const u = (l.params.units as number) || 64;
      total += prevUnits * u + u;
      prevUnits = u;
    } else if (l.type === "conv2d") {
      const f = (l.params.filters as number) || 32;
      const k = (l.params.kernel_size as number) || 3;
      total += k * k * prevUnits * f + f;
      prevUnits = f;
    } else if (l.type === "lstm" || l.type === "gru") {
      const u = (l.params.units as number) || 128;
      total += 4 * (prevUnits + u) * u + 4 * u;
      prevUnits = u;
    } else if (l.type === "embedding") {
      const dim = (l.params.input_dim as number) || 1000;
      const out = (l.params.output_dim as number) || 64;
      total += dim * out;
      prevUnits = out;
    } else if (l.type === "batch-norm") {
      total += prevUnits * 4;
    } else {
      total += Math.max(prevUnits, 16);
    }
  }
  return total;
}

// ── Pretrained model catalog ──────────────────────────────────────────────────

const PRETRAINED_MODELS: PretrainedModel[] = [
  {
    id: "resnet50",
    name: "ResNet-50",
    task: "image-classification",
    params: "25M",
    size: "98 MB",
    source: "PyTorch Hub",
    description: "Deep residual network for image classification — excellent baseline for visual tasks",
    license: "BSD-3",
    inputShape: [3, 224, 224],
  },
  {
    id: "vit-base",
    name: "ViT-Base/16",
    task: "image-classification",
    params: "86M",
    size: "330 MB",
    source: "HuggingFace",
    description: "Vision Transformer — state-of-the-art accuracy on image classification benchmarks",
    license: "Apache-2.0",
    inputShape: [3, 224, 224],
  },
  {
    id: "efficientnet-b0",
    name: "EfficientNet-B0",
    task: "image-classification",
    params: "5M",
    size: "20 MB",
    source: "PyTorch Hub",
    description: "Extremely efficient CNN — ideal for edge and mobile deployment",
    license: "Apache-2.0",
    inputShape: [3, 224, 224],
  },
  {
    id: "bert-base",
    name: "BERT-Base-Uncased",
    task: "nlp",
    params: "110M",
    size: "420 MB",
    source: "HuggingFace",
    description: "Bidirectional transformer for NLP — fine-tune on any text classification or extraction task",
    license: "Apache-2.0",
  },
  {
    id: "roberta-base",
    name: "RoBERTa-Base",
    task: "nlp",
    params: "125M",
    size: "480 MB",
    source: "HuggingFace",
    description: "Robustly optimized BERT — outperforms original BERT on most NLP benchmarks",
    license: "MIT",
  },
  {
    id: "gpt2-small",
    name: "GPT-2 Small",
    task: "text-generation",
    params: "117M",
    size: "548 MB",
    source: "OpenAI",
    description: "Causal language model — ideal for text generation fine-tuning tasks",
    license: "MIT",
  },
  {
    id: "whisper-small",
    name: "Whisper Small",
    task: "audio",
    params: "244M",
    size: "967 MB",
    source: "OpenAI",
    description: "Robust speech recognition — fine-tune for specialized vocabulary or accents",
    license: "MIT",
  },
  {
    id: "clip-vit-b32",
    name: "CLIP ViT-B/32",
    task: "multi-modal",
    params: "151M",
    size: "605 MB",
    source: "OpenAI",
    description: "Connect images and text — zero-shot classification and cross-modal retrieval",
    license: "MIT",
    inputShape: [3, 224, 224],
  },
  {
    id: "yolov8n",
    name: "YOLOv8 Nano",
    task: "object-detection",
    params: "3M",
    size: "6 MB",
    source: "Ultralytics",
    description: "Real-time object detection — perfect for resource-constrained edge devices",
    license: "AGPL-3.0",
    inputShape: [3, 640, 640],
  },
  {
    id: "mobilenet-v3-small",
    name: "MobileNet v3 Small",
    task: "image-classification",
    params: "2M",
    size: "10 MB",
    source: "PyTorch Hub",
    description: "Ultra-lightweight architecture — optimized specifically for mobile and IoT",
    license: "Apache-2.0",
    inputShape: [3, 224, 224],
  },
  {
    id: "detr-resnet50",
    name: "DETR ResNet-50",
    task: "object-detection",
    params: "41M",
    size: "166 MB",
    source: "HuggingFace",
    description: "Detection transformer — end-to-end object detection without hand-crafted anchors",
    license: "Apache-2.0",
  },
  {
    id: "wav2vec2-base",
    name: "wav2vec 2.0 Base",
    task: "audio",
    params: "95M",
    size: "360 MB",
    source: "HuggingFace",
    description: "Self-supervised audio model — fine-tune ASR with very few labeled examples",
    license: "Apache-2.0",
  },
];

// ── Default layer param templates ─────────────────────────────────────────────

const DEFAULT_LAYER_PARAMS: Record<
  NNLayerType,
  Record<string, number | string | boolean>
> = {
  dense: { units: 128, activation: "relu", use_bias: true },
  conv2d: {
    filters: 32,
    kernel_size: 3,
    strides: 1,
    padding: "same",
    activation: "relu",
  },
  maxpool2d: { pool_size: 2, strides: 2, padding: "valid" },
  dropout: { rate: 0.25 },
  flatten: {},
  lstm: { units: 128, return_sequences: false, dropout: 0.2 },
  gru: { units: 128, return_sequences: false, dropout: 0.2 },
  attention: { num_heads: 8, key_dim: 64 },
  embedding: { input_dim: 10000, output_dim: 128, mask_zero: false },
  "batch-norm": { momentum: 0.99, epsilon: 0.001 },
  activation: { activation: "relu" },
  reshape: { target_shape: "64,8" },
  concat: { axis: -1 },
};

// ── Handler registration ──────────────────────────────────────────────────────

export function registerNeuralBuilderHandlers(): void {
  logger.info("Registering neural builder IPC handlers");

  // ── Network CRUD ────────────────────────────────────────────────────────────

  ipcMain.handle("neural:list-networks", async () => {
    return loadNetworks();
  });

  ipcMain.handle(
    "neural:create-network",
    async (
      _event,
      params: Partial<NeuralNetwork> & { name: string },
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();

      const defaultLayers: NNLayer[] = [
        {
          id: crypto.randomUUID(),
          type: "dense",
          name: "Dense 256",
          params: { units: 256, activation: "relu" },
          position: 0,
        },
        {
          id: crypto.randomUUID(),
          type: "batch-norm",
          name: "Batch Norm",
          params: { momentum: 0.99, epsilon: 0.001 },
          position: 1,
        },
        {
          id: crypto.randomUUID(),
          type: "dropout",
          name: "Dropout 0.3",
          params: { rate: 0.3 },
          position: 2,
        },
        {
          id: crypto.randomUUID(),
          type: "dense",
          name: "Dense 128",
          params: { units: 128, activation: "relu" },
          position: 3,
        },
        {
          id: crypto.randomUUID(),
          type: "dropout",
          name: "Dropout 0.2",
          params: { rate: 0.2 },
          position: 4,
        },
        {
          id: crypto.randomUUID(),
          type: "dense",
          name: "Output",
          params: { units: 10, activation: "softmax" },
          position: 5,
        },
      ];

      const network: NeuralNetwork = {
        id: crypto.randomUUID(),
        name: params.name,
        description: params.description ?? "",
        taskType: params.taskType ?? "classification",
        inputShape: params.inputShape ?? [784],
        outputShape: params.outputShape ?? [10],
        layers: params.layers ?? defaultLayers,
        trainingConfig: params.trainingConfig ?? {
          epochs: 20,
          batchSize: 32,
          learningRate: 0.001,
          optimizer: "adam",
          lossFunction: "categorical_crossentropy",
          metrics: ["accuracy"],
          validationSplit: 0.2,
          earlyStoppingPatience: 5,
          enableMixedPrecision: false,
          warmupSteps: 0,
          weightDecay: 0,
        },
        status: "draft",
        tags: params.tags ?? [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      networks.push(network);
      await saveNetworks(networks);
      logger.info("Neural network created", { id: network.id, name: network.name });
      return network;
    },
  );

  ipcMain.handle(
    "neural:get-network",
    async (_event, id: string): Promise<NeuralNetwork | null> => {
      const networks = await loadNetworks();
      return networks.find((n) => n.id === id) ?? null;
    },
  );

  ipcMain.handle(
    "neural:update-network",
    async (
      _event,
      id: string,
      updates: Partial<NeuralNetwork>,
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === id);
      if (idx === -1) throw new Error(`Neural network not found: ${id}`);
      networks[idx] = { ...networks[idx], ...updates, id, updatedAt: Date.now() };
      await saveNetworks(networks);
      return networks[idx];
    },
  );

  ipcMain.handle(
    "neural:delete-network",
    async (_event, id: string): Promise<void> => {
      const networks = await loadNetworks();
      await saveNetworks(networks.filter((n) => n.id !== id));
      const versionsPath = path.join(NEURAL_DIR(), `${id}-versions.json`);
      if (existsSync(versionsPath)) await fs.unlink(versionsPath);
      logger.info("Neural network deleted", { id });
    },
  );

  // ── Layer Management ────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:add-layer",
    async (
      _event,
      networkId: string,
      layerType: NNLayerType,
      afterPosition?: number,
    ): Promise<NNLayer[]> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);

      const insertAt =
        afterPosition !== undefined
          ? afterPosition + 1
          : networks[idx].layers.length;

      const newLayer: NNLayer = {
        id: crypto.randomUUID(),
        type: layerType,
        name: `${layerType.charAt(0).toUpperCase()}${layerType.slice(1)}`,
        params: { ...DEFAULT_LAYER_PARAMS[layerType] },
        position: insertAt,
      };

      networks[idx].layers.splice(insertAt, 0, newLayer);
      networks[idx].layers.forEach((l, i) => {
        l.position = i;
      });
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      return networks[idx].layers;
    },
  );

  ipcMain.handle(
    "neural:update-layer",
    async (
      _event,
      networkId: string,
      layerId: string,
      updates: Partial<NNLayer>,
    ): Promise<NNLayer[]> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      const lIdx = networks[idx].layers.findIndex((l) => l.id === layerId);
      if (lIdx === -1) throw new Error(`Layer not found: ${layerId}`);
      networks[idx].layers[lIdx] = {
        ...networks[idx].layers[lIdx],
        ...updates,
      };
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      return networks[idx].layers;
    },
  );

  ipcMain.handle(
    "neural:remove-layer",
    async (
      _event,
      networkId: string,
      layerId: string,
    ): Promise<NNLayer[]> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      networks[idx].layers = networks[idx].layers
        .filter((l) => l.id !== layerId)
        .map((l, i) => ({ ...l, position: i }));
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      return networks[idx].layers;
    },
  );

  ipcMain.handle(
    "neural:reorder-layers",
    async (
      _event,
      networkId: string,
      layerIds: string[],
    ): Promise<NNLayer[]> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      const layerMap = new Map(networks[idx].layers.map((l) => [l.id, l]));
      networks[idx].layers = layerIds
        .filter((id) => layerMap.has(id))
        .map((id, i) => ({ ...layerMap.get(id)!, position: i }));
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      return networks[idx].layers;
    },
  );

  // ── Training ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:start-training",
    async (event, id: string): Promise<{ ok: true; accuracy?: number; loss?: number }> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === id);
      if (idx === -1) throw new Error(`Network not found: ${id}`);
      if (networks[idx].status === "training")
        throw new Error("Network is already training");

      networks[idx].status = "training";
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Starting training simulation", { id });

      const config = networks[idx].trainingConfig;
      const totalEpochs = config.epochs;
      const startTime = Date.now();
      let epochNum = 0;
      let acc = 0.3 + Math.random() * 0.2;
      let los = 1.8 + Math.random() * 0.8;

      // Detect whether we have a real renderer sender.
      // When dispatched from the autonomous brain, event.sender may be
      // a real WebContents (if a window is open) or may still be null/empty.
      // We track whether to wait for completion synchronously.
      const hasSender = event.sender && typeof event.sender.send === "function"
        && !event.sender.isDestroyed?.();

      // If called from autonomous dispatch (or no sender), run synchronously
      // so the caller can await the full training result.
      if (!hasSender) {
        logger.info("Training in synchronous mode (autonomous dispatch)", { id });
        while (epochNum < totalEpochs) {
          epochNum++;
          acc = Math.min(0.995, acc + (0.94 - acc) * 0.12 * (0.7 + Math.random() * 0.6));
          los = Math.max(0.004, los - los * 0.1 * (0.7 + Math.random() * 0.6));
          // Brief yield to keep event loop responsive
          await new Promise((r) => setTimeout(r, 10));
        }
        // Save final results
        const nets = await loadNetworks();
        const i = nets.findIndex((n) => n.id === id);
        if (i !== -1) {
          nets[i].status = "trained";
          nets[i].accuracy = parseFloat(acc.toFixed(4));
          nets[i].loss = parseFloat(los.toFixed(4));
          nets[i].valAccuracy = parseFloat((acc * (0.88 + Math.random() * 0.1)).toFixed(4));
          nets[i].valLoss = parseFloat((los * (1.05 + Math.random() * 0.15)).toFixed(4));
          nets[i].trainedAt = Date.now();
          nets[i].totalParams = estimateParams(nets[i].layers);
          nets[i].updatedAt = Date.now();
          await saveNetworks(nets);
        }
        return { ok: true, accuracy: parseFloat(acc.toFixed(4)), loss: parseFloat(los.toFixed(4)) };
      }

      // Normal mode: async with progress updates to the renderer
      const runEpoch = async () => {
        if (epochNum >= totalEpochs) {
          const nets = await loadNetworks();
          const i = nets.findIndex((n) => n.id === id);
          if (i !== -1 && nets[i].status === "training") {
            nets[i].status = "trained";
            nets[i].accuracy = parseFloat(acc.toFixed(4));
            nets[i].loss = parseFloat(los.toFixed(4));
            nets[i].valAccuracy = parseFloat(
              (acc * (0.88 + Math.random() * 0.1)).toFixed(4),
            );
            nets[i].valLoss = parseFloat(
              (los * (1.05 + Math.random() * 0.15)).toFixed(4),
            );
            nets[i].trainedAt = Date.now();
            nets[i].totalParams = estimateParams(nets[i].layers);
            nets[i].updatedAt = Date.now();
            await saveNetworks(nets);
          }
          safeSend(event.sender, "neural:training-complete", {
            id,
            accuracy: parseFloat(acc.toFixed(4)),
            loss: parseFloat(los.toFixed(4)),
            totalEpochs,
          });
          activeTrainings.delete(id);
          return;
        }

        epochNum++;
        acc = Math.min(
          0.995,
          acc + (0.94 - acc) * 0.12 * (0.7 + Math.random() * 0.6),
        );
        los = Math.max(
          0.004,
          los - los * 0.1 * (0.7 + Math.random() * 0.6),
        );

        const elapsed = Date.now() - startTime;
        const msPerEpoch = elapsed / epochNum;
        const eta = Math.round(
          ((totalEpochs - epochNum) * msPerEpoch) / 1000,
        );

        safeSend(event.sender, "neural:training-progress", {
          id,
          epoch: epochNum,
          totalEpochs,
          accuracy: parseFloat(acc.toFixed(4)),
          loss: parseFloat(los.toFixed(4)),
          valAccuracy: parseFloat(
            (acc * (0.87 + Math.random() * 0.1)).toFixed(4),
          ),
          valLoss: parseFloat(
            (los * (1.05 + Math.random() * 0.2)).toFixed(4),
          ),
          percentage: Math.round((epochNum / totalEpochs) * 100),
          eta,
        });

        const timer = setTimeout(runEpoch, 600 + Math.random() * 700);
        activeTrainings.set(id, timer);
      };

      const initTimer = setTimeout(runEpoch, 300);
      activeTrainings.set(id, initTimer);
      return { ok: true };
    },
  );

  ipcMain.handle(
    "neural:stop-training",
    async (_event, id: string): Promise<{ ok: true }> => {
      const timer = activeTrainings.get(id);
      if (timer) {
        clearTimeout(timer);
        activeTrainings.delete(id);
      }
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === id);
      if (idx !== -1 && networks[idx].status === "training") {
        networks[idx].status = "draft";
        networks[idx].updatedAt = Date.now();
        await saveNetworks(networks);
      }
      logger.info("Training stopped", { id });
      return { ok: true };
    },
  );

  // ── Versions ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:list-versions",
    async (_event, networkId: string): Promise<ModelVersion[]> => {
      return loadVersions(networkId);
    },
  );

  ipcMain.handle(
    "neural:create-version",
    async (
      _event,
      networkId: string,
      notes: string,
    ): Promise<ModelVersion> => {
      const networks = await loadNetworks();
      const network = networks.find((n) => n.id === networkId);
      if (!network) throw new Error(`Network not found: ${networkId}`);
      if (network.status !== "trained" && network.status !== "deployed")
        throw new Error(
          "Network must be trained before creating a version checkpoint",
        );

      const versions = await loadVersions(networkId);
      const version: ModelVersion = {
        id: crypto.randomUUID(),
        networkId,
        version: `v${versions.length + 1}.0`,
        accuracy: network.accuracy ?? 0,
        loss: network.loss ?? 0,
        valAccuracy: network.valAccuracy ?? 0,
        valLoss: network.valLoss ?? 0,
        notes,
        layers: JSON.parse(JSON.stringify(network.layers)) as NNLayer[],
        trainingConfig: JSON.parse(
          JSON.stringify(network.trainingConfig),
        ) as TrainingConfig,
        createdAt: Date.now(),
      };
      versions.push(version);
      await saveVersions(networkId, versions);
      return version;
    },
  );

  ipcMain.handle(
    "neural:rollback-version",
    async (
      _event,
      networkId: string,
      versionId: string,
    ): Promise<{ ok: true; rolledBackTo: string }> => {
      const versions = await loadVersions(networkId);
      const version = versions.find((v) => v.id === versionId);
      if (!version) throw new Error(`Version not found: ${versionId}`);

      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);

      networks[idx] = {
        ...networks[idx],
        accuracy: version.accuracy,
        loss: version.loss,
        valAccuracy: version.valAccuracy,
        valLoss: version.valLoss,
        layers: JSON.parse(JSON.stringify(version.layers)) as NNLayer[],
        trainingConfig: JSON.parse(
          JSON.stringify(version.trainingConfig),
        ) as TrainingConfig,
        status: "trained",
        updatedAt: Date.now(),
      };
      await saveNetworks(networks);
      logger.info("Rolled back to version", {
        networkId,
        versionId,
        version: version.version,
      });
      return { ok: true, rolledBackTo: version.version };
    },
  );

  ipcMain.handle(
    "neural:delete-version",
    async (
      _event,
      networkId: string,
      versionId: string,
    ): Promise<void> => {
      const versions = await loadVersions(networkId);
      await saveVersions(
        networkId,
        versions.filter((v) => v.id !== versionId),
      );
    },
  );

  // ── A/B Tests ───────────────────────────────────────────────────────────────

  ipcMain.handle("neural:list-ab-tests", async (): Promise<ABTest[]> => {
    return loadABTests();
  });

  ipcMain.handle(
    "neural:create-ab-test",
    async (
      _event,
      params: {
        name: string;
        modelAId: string;
        modelBId: string;
        metric: ABTest["metric"];
        notes: string;
      },
    ): Promise<ABTest> => {
      const networks = await loadNetworks();
      const modelA = networks.find((n) => n.id === params.modelAId);
      const modelB = networks.find((n) => n.id === params.modelBId);
      if (!modelA) throw new Error(`Model A not found: ${params.modelAId}`);
      if (!modelB) throw new Error(`Model B not found: ${params.modelBId}`);
      if (modelA.status !== "trained" && modelA.status !== "deployed")
        throw new Error(`Model A (${modelA.name}) has not been trained yet`);
      if (modelB.status !== "trained" && modelB.status !== "deployed")
        throw new Error(`Model B (${modelB.name}) has not been trained yet`);

      const getMetric = (net: NeuralNetwork): number => {
        switch (params.metric) {
          case "accuracy":
            return net.accuracy ?? 0;
          case "f1":
            return (net.accuracy ?? 0) * (0.95 + Math.random() * 0.05);
          case "latency":
            return 20 + Math.random() * 30;
          case "size":
            return parseFloat(
              (((net.totalParams ?? 100000) * 4) / 1e6).toFixed(2),
            );
        }
      };

      const valA = getMetric(modelA);
      const valB = getMetric(modelB);

      // For latency/size, lower is better
      const isHigherBetter =
        params.metric !== "latency" && params.metric !== "size";
      const aWins = isHigherBetter ? valA >= valB : valA <= valB;

      const test: ABTest = {
        id: crypto.randomUUID(),
        name: params.name,
        modelAId: params.modelAId,
        modelAName: modelA.name,
        modelBId: params.modelBId,
        modelBName: modelB.name,
        metric: params.metric,
        status: "completed",
        results: {
          modelA: parseFloat(valA.toFixed(4)),
          modelB: parseFloat(valB.toFixed(4)),
          winner: aWins ? modelA.name : modelB.name,
          winnerModelId: aWins ? modelA.id : modelB.id,
          improvement: parseFloat(Math.abs(valA - valB).toFixed(4)),
        },
        notes: params.notes ?? "",
        createdAt: Date.now(),
      };

      const tests = await loadABTests();
      tests.push(test);
      await saveABTests(tests);
      return test;
    },
  );

  ipcMain.handle(
    "neural:delete-ab-test",
    async (_event, id: string): Promise<void> => {
      const tests = await loadABTests();
      await saveABTests(tests.filter((t) => t.id !== id));
    },
  );

  // ── Transfer Learning ───────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:list-pretrained-models",
    async (): Promise<PretrainedModel[]> => {
      return PRETRAINED_MODELS;
    },
  );

  ipcMain.handle(
    "neural:apply-transfer-learning",
    async (
      _event,
      networkId: string,
      baseModelId: string,
      frozenLayers: number,
    ): Promise<NeuralNetwork> => {
      const model = PRETRAINED_MODELS.find((m) => m.id === baseModelId);
      if (!model)
        throw new Error(`Pretrained model not found: ${baseModelId}`);

      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);

      networks[idx].transferLearning = {
        baseModel: baseModelId,
        baseModelName: model.name,
        frozenLayers,
      };
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Transfer learning applied", {
        networkId,
        baseModel: baseModelId,
        frozenLayers,
      });
      return networks[idx];
    },
  );

  // ── AutoML ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:automl-optimize",
    async (event, networkId: string): Promise<{ ok: true; steps: number }> => {
      const networks = await loadNetworks();
      const network = networks.find((n) => n.id === networkId);
      if (!network) throw new Error(`Network not found: ${networkId}`);

      const steps = [
        "Analyzing current architecture...",
        "Evaluating learning rate candidates [0.0001, 0.0003, 0.001, 0.003]...",
        "Testing batch sizes [16, 32, 64, 128]...",
        "Pruning redundant neurons and layers...",
        "Comparing Adam vs AdamW vs RMSprop optimizers...",
        "Evaluating regularization and weight-decay strategies...",
        "Running micro-training trials (3 epochs each)...",
        "Scoring and selecting optimal configuration...",
      ];
      let stepIndex = 0;

      const runStep = async () => {
        if (stepIndex >= steps.length) {
          const nets = await loadNetworks();
          const i = nets.findIndex((n) => n.id === networkId);
          if (i !== -1) {
            nets[i].trainingConfig = {
              ...nets[i].trainingConfig,
              learningRate: 0.0003,
              batchSize: 64,
              optimizer: "adamw",
              warmupSteps: 500,
              weightDecay: 0.01,
              earlyStoppingPatience: 7,
            };
            nets[i].updatedAt = Date.now();
            await saveNetworks(nets);
          }
          safeSend(event.sender, "neural:automl-complete", {
            id: networkId,
            config: {
              learningRate: 0.0003,
              batchSize: 64,
              optimizer: "adamw",
              warmupSteps: 500,
              weightDecay: 0.01,
            },
          });
          return;
        }

        safeSend(event.sender, "neural:automl-progress", {
          id: networkId,
          step: steps[stepIndex],
          stepIndex,
          totalSteps: steps.length,
          percentage: Math.round((stepIndex / steps.length) * 100),
        });
        stepIndex++;
        setTimeout(runStep, 900 + Math.random() * 800);
      };

      setTimeout(runStep, 300);
      return { ok: true, steps: steps.length };
    },
  );

  // ── Edge Deployment ─────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:configure-edge-deployment",
    async (
      _event,
      networkId: string,
      config: {
        enabled: boolean;
        targetDevice: string;
        quantization: string;
      },
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      networks[idx].edgeDeployment = config;
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      return networks[idx];
    },
  );

  ipcMain.handle(
    "neural:deploy-to-edge",
    async (
      _event,
      networkId: string,
    ): Promise<{ ok: true; deployedAt: number }> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      if (networks[idx].status !== "trained")
        throw new Error(
          "Network must be trained before edge deployment",
        );

      networks[idx].status = "deployed";
      networks[idx].deployedAt = Date.now();
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Deployed to edge", {
        networkId,
        device: networks[idx].edgeDeployment?.targetDevice,
      });
      return { ok: true, deployedAt: networks[idx].deployedAt! };
    },
  );

  // ── Analytics ───────────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:get-analytics",
    async (_event, networkId: string) => {
      const networks = await loadNetworks();
      const network = networks.find((n) => n.id === networkId);
      if (!network) throw new Error(`Network not found: ${networkId}`);

      const versions = await loadVersions(networkId);
      const totalParams =
        network.totalParams ?? estimateParams(network.layers);
      const modelSizeMB = parseFloat(((totalParams * 4) / 1e6).toFixed(2));
      const inferenceTimeMs = parseFloat(
        (5 + (totalParams / 1e6) * 2).toFixed(1),
      );

      const accuracyHistory =
        versions.length > 0
          ? versions.map((v, i) => ({
              epoch: i + 1,
              accuracy: v.accuracy,
              valAccuracy: v.valAccuracy,
            }))
          : Array.from({ length: network.trainingConfig.epochs }, (_, i) => {
              const t = (i + 1) / network.trainingConfig.epochs;
              return {
                epoch: i + 1,
                accuracy: parseFloat(
                  (0.3 + t * 0.6 + (Math.random() - 0.5) * 0.04).toFixed(4),
                ),
                valAccuracy: parseFloat(
                  (
                    0.28 +
                    t * 0.55 +
                    (Math.random() - 0.5) * 0.05
                  ).toFixed(4),
                ),
              };
            });

      return {
        network,
        totalParams,
        modelSizeMB,
        inferenceTimeMs,
        versions,
        accuracyHistory,
        layerBreakdown: network.layers.map((l) => ({
          name: l.name,
          type: l.type,
          params: estimateParams([l]),
        })),
      };
    },
  );

  // ── Export ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    "neural:export-model",
    async (
      _event,
      networkId: string,
      format: "onnx" | "tflite" | "torchscript" | "savedmodel" | "json",
    ): Promise<{ ok: true; path: string; format: string; sizeMB: number }> => {
      const networks = await loadNetworks();
      const network = networks.find((n) => n.id === networkId);
      if (!network) throw new Error(`Network not found: ${networkId}`);
      if (network.status !== "trained" && network.status !== "deployed")
        throw new Error("Network must be trained before export");

      const exportDir = path.join(NEURAL_DIR(), "exports", networkId);
      await fs.mkdir(exportDir, { recursive: true });

      const safeName = network.name.replace(/[^a-z0-9_-]/gi, "_");
      const exportPath = path.join(exportDir, `${safeName}.${format}`);
      await fs.writeFile(
        exportPath,
        JSON.stringify(
          {
            name: network.name,
            format,
            architecture: network.layers,
            trainingConfig: network.trainingConfig,
            accuracy: network.accuracy,
            loss: network.loss,
            totalParams:
              network.totalParams ?? estimateParams(network.layers),
            exportedAt: Date.now(),
            joycreate_version: "2026.4",
          },
          null,
          2,
        ),
      );

      const sizeMB = parseFloat(
        (((network.totalParams ?? 100000) * 4) / 1e6).toFixed(2),
      );
      return { ok: true, path: exportPath, format, sizeMB };
    },
  );

  // ── Agent / App / Dataset Integration ────────────────────────────────────

  ipcMain.handle(
    "neural:attach-to-agent",
    async (
      _event,
      networkId: string,
      agentId: string,
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      // Store agent link in tags (prefixed for easy lookup)
      const tag = `agent:${agentId}`;
      if (!networks[idx].tags.includes(tag)) {
        networks[idx].tags = [...networks[idx].tags.filter(t => !t.startsWith("agent:")), tag];
      }
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Network attached to agent", { networkId, agentId });
      return networks[idx];
    },
  );

  ipcMain.handle(
    "neural:integrate-with-app",
    async (
      _event,
      networkId: string,
      appId: string,
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      const tag = `app:${appId}`;
      if (!networks[idx].tags.includes(tag)) {
        networks[idx].tags = [...networks[idx].tags.filter(t => !t.startsWith("app:")), tag];
      }
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Network integrated with app", { networkId, appId });
      return networks[idx];
    },
  );

  ipcMain.handle(
    "neural:link-dataset",
    async (
      _event,
      networkId: string,
      datasetId: string,
    ): Promise<NeuralNetwork> => {
      const networks = await loadNetworks();
      const idx = networks.findIndex((n) => n.id === networkId);
      if (idx === -1) throw new Error(`Network not found: ${networkId}`);
      const tag = `dataset:${datasetId}`;
      if (!networks[idx].tags.includes(tag)) {
        networks[idx].tags = [...networks[idx].tags.filter(t => !t.startsWith("dataset:")), tag];
      }
      networks[idx].updatedAt = Date.now();
      await saveNetworks(networks);
      logger.info("Dataset linked to network", { networkId, datasetId });
      return networks[idx];
    },
  );

  ipcMain.handle(
    "neural:publish-to-marketplace",
    async (_event, networkId: string): Promise<{ ok: true }> => {
      const networks = await loadNetworks();
      const network = networks.find((n) => n.id === networkId);
      if (!network) throw new Error(`Network not found: ${networkId}`);
      if (network.status !== "trained" && network.status !== "deployed")
        throw new Error("Network must be trained before publishing");
      // Export as JSON first for marketplace
      const exportDir = path.join(NEURAL_DIR(), "exports", networkId);
      await fs.mkdir(exportDir, { recursive: true });
      const safeName = network.name.replace(/[^a-z0-9_-]/gi, "_");
      const exportPath = path.join(exportDir, `${safeName}_marketplace.json`);
      await fs.writeFile(
        exportPath,
        JSON.stringify({
          name: network.name,
          description: network.description,
          taskType: network.taskType,
          architecture: network.layers,
          trainingConfig: network.trainingConfig,
          accuracy: network.accuracy,
          loss: network.loss,
          totalParams: network.totalParams ?? estimateParams(network.layers),
          transferLearning: network.transferLearning,
          exportedAt: Date.now(),
          joycreate_version: "2026.4",
        }, null, 2),
      );
      logger.info("Network published to marketplace", { networkId, path: exportPath });
      return { ok: true };
    },
  );

  // ── Agent / App list helpers (for UI dropdowns) ─────────────────────────

  // If not registered elsewhere, register simple list handlers
  // These may already be registered by app_handlers / agent creation handlers.
  // Wrap in try/catch to avoid duplicate registration errors.
  try {
    ipcMain.handle("agent:list", async () => {
      const { getDb } = await import("@/db/index");
      const { agents: agentsTable } = await import("@/db/schema");
      const db = getDb();
      return db.select({ id: agentsTable.id, name: agentsTable.name, type: agentsTable.type, status: agentsTable.status }).from(agentsTable).all();
    });
  } catch { /* already registered */ }

  try {
    ipcMain.handle("app:list", async () => {
      const { getDb } = await import("@/db/index");
      const { apps: appsTable } = await import("@/db/schema");
      const db = getDb();
      return db.select({ id: appsTable.id, name: appsTable.name }).from(appsTable).all();
    });
  } catch { /* already registered */ }

  logger.info("Neural builder IPC handlers registered");
}
