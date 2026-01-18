/**
 * Decentralized Deployment IPC Handlers
 * Handles deployments to 4everland, Fleek, IPFS, Arweave, and other Web3 platforms
 */

import { ipcMain } from "electron";
import * as fs from "fs/promises";
import * as path from "path";
import { app } from "electron";
import log from "electron-log";
import { getDyadAppPath } from "@/paths/paths";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import type {
  DecentralizedPlatform,
  PlatformCredentials,
  DecentralizedDeployRequest,
  DecentralizedDeployResult,
  DecentralizedDeployment,
  DecentralizedBuildConfig,
  IPFSPinStatus,
  PLATFORM_CONFIGS,
} from "../../types/decentralized_deploy";

const logger = log.scope("decentralized_deploy_handlers");

// ============================================================================
// Constants & Configuration
// ============================================================================

const DEPLOY_DATA_DIR = path.join(app.getPath("userData"), "decentralized-deployments");
const CREDENTIALS_FILE = path.join(DEPLOY_DATA_DIR, "credentials.json");
const DEPLOYMENTS_FILE = path.join(DEPLOY_DATA_DIR, "deployments.json");

// Platform API endpoints
const API_ENDPOINTS = {
  "4everland": "https://api.4everland.org",
  "fleek": "https://api.fleek.xyz",
  "ipfs-pinata": "https://api.pinata.cloud",
  "ipfs-infura": "https://ipfs.infura.io:5001",
  "ipfs-web3storage": "https://api.web3.storage",
  "arweave": "https://arweave.net",
  "filecoin": "https://api.estuary.tech",
  "skynet": "https://siasky.net",
  "spheron": "https://api.spheron.network",
  "filebase": "https://api.filebase.io",
};

// ============================================================================
// Initialization
// ============================================================================

async function ensureDirectories(): Promise<void> {
  await fs.mkdir(DEPLOY_DATA_DIR, { recursive: true });
}

// ============================================================================
// Credential Management
// ============================================================================

async function loadCredentials(): Promise<Record<DecentralizedPlatform, PlatformCredentials>> {
  await ensureDirectories();
  try {
    const data = await fs.readFile(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {} as Record<DecentralizedPlatform, PlatformCredentials>;
  }
}

async function saveCredentials(
  credentials: Record<DecentralizedPlatform, PlatformCredentials>
): Promise<void> {
  await ensureDirectories();
  await fs.writeFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

async function getCredentials(platform: DecentralizedPlatform): Promise<PlatformCredentials | null> {
  const creds = await loadCredentials();
  return creds[platform] || null;
}

// ============================================================================
// Deployment Storage
// ============================================================================

async function loadDeployments(): Promise<DecentralizedDeployment[]> {
  await ensureDirectories();
  try {
    const data = await fs.readFile(DEPLOYMENTS_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveDeployments(deployments: DecentralizedDeployment[]): Promise<void> {
  await ensureDirectories();
  await fs.writeFile(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
}

async function addDeployment(deployment: DecentralizedDeployment): Promise<void> {
  const deployments = await loadDeployments();
  deployments.unshift(deployment);
  await saveDeployments(deployments);
}

async function updateDeployment(
  id: string,
  updates: Partial<DecentralizedDeployment>
): Promise<void> {
  const deployments = await loadDeployments();
  const index = deployments.findIndex((d) => d.id === id);
  if (index !== -1) {
    deployments[index] = { ...deployments[index], ...updates, updatedAt: Date.now() };
    await saveDeployments(deployments);
  }
}

// ============================================================================
// Build & Package App
// ============================================================================

async function buildApp(
  appPath: string,
  config: DecentralizedBuildConfig
): Promise<{ success: boolean; outputPath: string; logs: string[] }> {
  const logs: string[] = [];
  const outputPath = path.join(appPath, config.outputDir);

  try {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    // Install dependencies
    if (config.installCommand) {
      logs.push(`Running: ${config.installCommand}`);
      const { stdout, stderr } = await execAsync(config.installCommand, { cwd: appPath });
      if (stdout) logs.push(stdout);
      if (stderr) logs.push(stderr);
    }

    // Build the app
    logs.push(`Running: ${config.buildCommand}`);
    const { stdout, stderr } = await execAsync(config.buildCommand, {
      cwd: appPath,
      env: { ...process.env, ...config.envVars },
    });
    if (stdout) logs.push(stdout);
    if (stderr) logs.push(stderr);

    // Check if output directory exists
    await fs.access(outputPath);
    logs.push(`Build successful! Output: ${outputPath}`);

    return { success: true, outputPath, logs };
  } catch (error) {
    logs.push(`Build failed: ${error}`);
    return { success: false, outputPath, logs };
  }
}

// ============================================================================
// Platform-Specific Deployments
// ============================================================================

// 4EVERLAND Deployment
async function deployTo4Everland(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  const FormData = (await import("form-data")).default;
  const formData = new FormData();
  
  // Read all files from output directory and add to form
  const files = await getAllFiles(outputPath);
  for (const file of files) {
    const relativePath = path.relative(outputPath, file);
    const content = await fs.readFile(file);
    formData.append("file", content, { filepath: relativePath });
  }

  try {
    const response = await fetch(`${API_ENDPOINTS["4everland"]}/hosting/deploy`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: formData as any,
    });

    if (!response.ok) {
      throw new Error(`4EVERLAND deployment failed: ${response.statusText}`);
    }

    const result = await response.json();
    
    return {
      success: true,
      platform: "4everland",
      deploymentId: result.deploymentId || result.id,
      cid: result.cid,
      url: `https://${result.cid}.ipfs.4everland.io`,
      gatewayUrls: [
        `https://${result.cid}.ipfs.4everland.io`,
        `https://ipfs.io/ipfs/${result.cid}`,
        `https://dweb.link/ipfs/${result.cid}`,
      ],
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      platform: "4everland",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// Fleek Deployment
async function deployToFleek(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  try {
    // Fleek uses GraphQL API
    const mutation = `
      mutation DeploySite($input: DeploySiteInput!) {
        deploySite(input: $input) {
          id
          status
          ipfsHash
          url
        }
      }
    `;

    const response = await fetch(`${API_ENDPOINTS["fleek"]}/graphql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({
        query: mutation,
        variables: {
          input: {
            siteId: credentials.projectId,
          },
        },
      }),
    });

    const result = await response.json();
    const deployment = result.data?.deploySite;

    if (!deployment) {
      throw new Error("Fleek deployment failed");
    }

    return {
      success: true,
      platform: "fleek",
      deploymentId: deployment.id,
      cid: deployment.ipfsHash,
      url: deployment.url,
      gatewayUrls: [
        deployment.url,
        `https://ipfs.io/ipfs/${deployment.ipfsHash}`,
      ],
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      platform: "fleek",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// Pinata IPFS Deployment
async function deployToPinata(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  const FormData = (await import("form-data")).default;
  const formData = new FormData();

  // Add files to form data
  const files = await getAllFiles(outputPath);
  for (const file of files) {
    const relativePath = path.relative(outputPath, file);
    const content = await fs.readFile(file);
    formData.append("file", content, { filepath: `root/${relativePath}` });
  }

  // Add metadata
  formData.append(
    "pinataMetadata",
    JSON.stringify({
      name: metadata?.name || "JoyCreate Deployment",
      keyvalues: metadata,
    })
  );

  try {
    const response = await fetch(`${API_ENDPOINTS["ipfs-pinata"]}/pinning/pinFileToIPFS`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: formData as any,
    });

    if (!response.ok) {
      throw new Error(`Pinata upload failed: ${response.statusText}`);
    }

    const result = await response.json();

    return {
      success: true,
      platform: "ipfs-pinata",
      deploymentId: result.id || result.IpfsHash,
      cid: result.IpfsHash,
      url: `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
      gatewayUrls: [
        `https://gateway.pinata.cloud/ipfs/${result.IpfsHash}`,
        `https://ipfs.io/ipfs/${result.IpfsHash}`,
        `https://dweb.link/ipfs/${result.IpfsHash}`,
        `https://cloudflare-ipfs.com/ipfs/${result.IpfsHash}`,
      ],
      timestamp: Date.now(),
      size: result.PinSize,
    };
  } catch (error) {
    return {
      success: false,
      platform: "ipfs-pinata",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// web3.storage Deployment
async function deployToWeb3Storage(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  try {
    // Use the web3.storage HTTP API
    const files = await getAllFiles(outputPath);
    const carFile = await createCarFile(outputPath, files);

    const response = await fetch(`${API_ENDPOINTS["ipfs-web3storage"]}/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
        "Content-Type": "application/car",
      },
      body: carFile as unknown as BodyInit,
    });

    if (!response.ok) {
      throw new Error(`web3.storage upload failed: ${response.statusText}`);
    }

    const result = await response.json();

    return {
      success: true,
      platform: "ipfs-web3storage",
      deploymentId: result.cid,
      cid: result.cid,
      url: `https://w3s.link/ipfs/${result.cid}`,
      gatewayUrls: [
        `https://w3s.link/ipfs/${result.cid}`,
        `https://ipfs.io/ipfs/${result.cid}`,
        `https://dweb.link/ipfs/${result.cid}`,
      ],
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      platform: "ipfs-web3storage",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// Arweave Deployment
async function deployToArweave(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  try {
    // For Arweave, we need to create a transaction with the wallet key
    // This is a simplified version - full implementation would use arweave-js
    
    const files = await getAllFiles(outputPath);
    const manifest = createArweaveManifest(outputPath, files);
    
    // Upload via Bundlr/Irys for easier bundled transactions
    const response = await fetch("https://node1.bundlr.network/tx/arweave", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({
        data: manifest,
        tags: [
          { name: "Content-Type", value: "application/x.arweave-manifest+json" },
          { name: "App-Name", value: "JoyCreate" },
          { name: "App-Version", value: metadata?.version || "1.0.0" },
        ],
      }),
    });

    const result = await response.json();

    return {
      success: true,
      platform: "arweave",
      deploymentId: result.id,
      txId: result.id,
      url: `https://arweave.net/${result.id}`,
      gatewayUrls: [
        `https://arweave.net/${result.id}`,
        `https://arweave.dev/${result.id}`,
      ],
      timestamp: Date.now(),
      cost: result.cost
        ? { amount: result.cost, currency: "AR" }
        : undefined,
    };
  } catch (error) {
    return {
      success: false,
      platform: "arweave",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// Spheron Deployment
async function deployToSpheron(
  outputPath: string,
  credentials: PlatformCredentials,
  metadata?: any
): Promise<DecentralizedDeployResult> {
  try {
    const FormData = (await import("form-data")).default;
    const formData = new FormData();

    const files = await getAllFiles(outputPath);
    for (const file of files) {
      const relativePath = path.relative(outputPath, file);
      const content = await fs.readFile(file);
      formData.append("files", content, { filepath: relativePath });
    }

    formData.append("name", metadata?.name || "joycreate-deployment");
    formData.append("protocol", "IPFS");

    const response = await fetch(`${API_ENDPOINTS["spheron"]}/v1/deployment`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: formData as any,
    });

    const result = await response.json();

    return {
      success: true,
      platform: "spheron",
      deploymentId: result.deploymentId,
      cid: result.ipfsHash,
      url: result.sitePreview,
      gatewayUrls: [
        result.sitePreview,
        `https://ipfs.io/ipfs/${result.ipfsHash}`,
      ],
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      success: false,
      platform: "spheron",
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: String(error),
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

async function createCarFile(basePath: string, files: string[]): Promise<Uint8Array> {
  // Simplified CAR file creation
  // In production, use @ipld/car library
  const fileContents: { path: string; content: Buffer }[] = [];
  
  for (const file of files) {
    const relativePath = path.relative(basePath, file);
    const content = await fs.readFile(file);
    fileContents.push({ path: relativePath, content });
  }

  // For now, return a tar-like buffer
  // Full implementation would create proper CAR format
  const jsonStr = JSON.stringify(fileContents.map(f => ({ path: f.path, size: f.content.length })));
  return new Uint8Array(Buffer.from(jsonStr));
}

function createArweaveManifest(
  basePath: string,
  files: string[]
): { manifest: string; version: string; index: { path: string }; paths: Record<string, { id: string }> } {
  const paths: Record<string, { id: string }> = {};
  
  for (const file of files) {
    const relativePath = path.relative(basePath, file);
    paths[relativePath] = { id: "" }; // Will be filled with actual tx IDs
  }

  return {
    manifest: "arweave/paths",
    version: "0.1.0",
    index: { path: "index.html" },
    paths,
  };
}

// ============================================================================
// Main Deploy Function
// ============================================================================

async function deployToPlatform(
  request: DecentralizedDeployRequest
): Promise<DecentralizedDeployResult> {
  const credentials = await getCredentials(request.platform);
  
  if (!credentials && request.platform !== "arweave" && request.platform !== "skynet") {
    return {
      success: false,
      platform: request.platform,
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: `No credentials configured for ${request.platform}`,
    };
  }

  // Get app path
  const appRecord = await db.select().from(apps).where(eq(apps.id, request.appId)).limit(1);
  if (!appRecord.length) {
    return {
      success: false,
      platform: request.platform,
      deploymentId: "",
      url: "",
      gatewayUrls: [],
      timestamp: Date.now(),
      error: "App not found",
    };
  }

  const appPath = getDyadAppPath(request.appId.toString());
  const outputPath = path.join(appPath, request.outputDir || "dist");

  // Build if needed
  if (request.buildCommand) {
    const buildResult = await buildApp(appPath, {
      buildCommand: request.buildCommand,
      outputDir: request.outputDir || "dist",
      envVars: request.envVars,
    });

    if (!buildResult.success) {
      return {
        success: false,
        platform: request.platform,
        deploymentId: "",
        url: "",
        gatewayUrls: [],
        timestamp: Date.now(),
        error: `Build failed: ${buildResult.logs.join("\n")}`,
      };
    }
  }

  // Deploy to platform
  let result: DecentralizedDeployResult;
  
  switch (request.platform) {
    case "4everland":
      result = await deployTo4Everland(outputPath, credentials!, request.metadata);
      break;
    case "fleek":
      result = await deployToFleek(outputPath, credentials!, request.metadata);
      break;
    case "ipfs-pinata":
      result = await deployToPinata(outputPath, credentials!, request.metadata);
      break;
    case "ipfs-web3storage":
      result = await deployToWeb3Storage(outputPath, credentials!, request.metadata);
      break;
    case "arweave":
      result = await deployToArweave(outputPath, credentials || {} as any, request.metadata);
      break;
    case "spheron":
      result = await deployToSpheron(outputPath, credentials!, request.metadata);
      break;
    default:
      result = {
        success: false,
        platform: request.platform,
        deploymentId: "",
        url: "",
        gatewayUrls: [],
        timestamp: Date.now(),
        error: `Platform ${request.platform} not yet supported`,
      };
  }

  // Save deployment record
  if (result.success) {
    await addDeployment({
      id: result.deploymentId,
      appId: request.appId,
      platform: request.platform,
      status: "live",
      cid: result.cid,
      txId: result.txId,
      url: result.url,
      gatewayUrls: result.gatewayUrls,
      ipnsName: result.ipnsName,
      ensName: request.ensName,
      customDomain: request.customDomain,
      metadata: request.metadata,
      size: result.size,
      cost: result.cost,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  return result;
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerDecentralizedDeployHandlers(): void {
  // Save platform credentials
  ipcMain.handle(
    "decentralized:save-credentials",
    async (_, platform: DecentralizedPlatform, credentials: PlatformCredentials) => {
      const allCreds = await loadCredentials();
      allCreds[platform] = { ...credentials, platform };
      await saveCredentials(allCreds);
      return { success: true };
    }
  );

  // Get platform credentials (without sensitive data)
  ipcMain.handle(
    "decentralized:get-credentials",
    async (_, platform: DecentralizedPlatform) => {
      const creds = await getCredentials(platform);
      if (!creds) return null;
      // Return without sensitive keys
      return {
        platform: creds.platform,
        projectId: creds.projectId,
        bucketName: creds.bucketName,
        hasApiKey: !!creds.apiKey,
        hasAccessToken: !!creds.accessToken,
      };
    }
  );

  // Remove platform credentials
  ipcMain.handle(
    "decentralized:remove-credentials",
    async (_, platform: DecentralizedPlatform) => {
      const allCreds = await loadCredentials();
      delete allCreds[platform];
      await saveCredentials(allCreds);
      return { success: true };
    }
  );

  // Deploy to decentralized platform
  ipcMain.handle(
    "decentralized:deploy",
    async (_, request: DecentralizedDeployRequest) => {
      logger.info(`Deploying app ${request.appId} to ${request.platform}`);
      return deployToPlatform(request);
    }
  );

  // Get deployments for an app
  ipcMain.handle(
    "decentralized:get-deployments",
    async (_, appId?: number) => {
      const deployments = await loadDeployments();
      if (appId) {
        return deployments.filter((d) => d.appId === appId);
      }
      return deployments;
    }
  );

  // Get single deployment
  ipcMain.handle(
    "decentralized:get-deployment",
    async (_, deploymentId: string) => {
      const deployments = await loadDeployments();
      return deployments.find((d) => d.id === deploymentId) || null;
    }
  );

  // Check IPFS pin status
  ipcMain.handle(
    "decentralized:check-pin-status",
    async (_, cid: string, platform: DecentralizedPlatform) => {
      const credentials = await getCredentials(platform);
      if (!credentials) {
        return { status: "unknown", error: "No credentials" };
      }

      try {
        let response;
        switch (platform) {
          case "ipfs-pinata":
            response = await fetch(
              `${API_ENDPOINTS["ipfs-pinata"]}/data/pinList?hashContains=${cid}`,
              {
                headers: { Authorization: `Bearer ${credentials.apiKey}` },
              }
            );
            break;
          default:
            return { status: "unknown", error: "Platform doesn't support pin status" };
        }

        const result = await response.json();
        return {
          cid,
          status: result.rows?.[0]?.status || "unknown",
          providers: [],
        };
      } catch (error) {
        return { status: "error", error: String(error) };
      }
    }
  );

  // Get supported platforms
  ipcMain.handle("decentralized:get-platforms", async () => {
    const { PLATFORM_CONFIGS } = await import("../../types/decentralized_deploy");
    return PLATFORM_CONFIGS;
  });

  logger.info("Decentralized deployment handlers registered");
}
