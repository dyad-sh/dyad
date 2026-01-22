/**
 * Vault Client
 * Client for interacting with Vault v2 Edge Functions and Supabase Storage
 */

import * as fs from "fs/promises";
import log from "electron-log";

const logger = log.scope("vault_client");

// Types matching Edge Function responses
export interface VaultBackup {
  id: string;
  projectName: string;
  sizeBytes: number | null;
  sha256: string | null;
  status: "pending" | "uploaded" | "failed";
  createdAt: string;
  appVersion: string | null;
  notes: string | null;
}

export interface SignedUploadResponse {
  backupId: string;
  path: string;
  signedUrl: string;
  token: string;
}

export interface SignedDownloadResponse {
  signedUrl: string;
  projectName: string;
  sha256: string | null;
  sizeBytes: number | null;
}

export interface VaultClientConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  getAccessToken: () => Promise<string | null>;
}

/**
 * Vault Client class for interacting with Vault v2 backend
 */
export class VaultClient {
  private config: VaultClientConfig;

  constructor(config: VaultClientConfig) {
    this.config = config;
  }

  /**
   * Get authorization header with Bearer token
   */
  private async getAuthHeader(): Promise<string> {
    const token = await this.config.getAccessToken();
    if (!token) {
      throw new Error("Not authenticated. Please sign in to use Vault.");
    }
    return `Bearer ${token}`;
  }

  /**
   * Make authenticated request to Edge Function
   */
  private async callEdgeFunction<T>(
    functionName: string,
    method: "GET" | "POST",
    body?: object
  ): Promise<T> {
    const url = `${this.config.supabaseUrl}/functions/v1/${functionName}`;
    const authHeader = await this.getAuthHeader();

    logger.debug(`Calling Edge Function: ${functionName}`);

    const fetchOptions: RequestInit = {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        apikey: this.config.supabaseAnonKey,
      },
    };

    // Only add body for non-GET requests
    if (method !== "GET" && body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errorMessage =
        errorBody.error || `HTTP ${response.status}: ${response.statusText}`;
      logger.error(`Edge Function error (${functionName}):`, errorMessage);
      throw new Error(errorMessage);
    }

    return response.json();
  }

  /**
   * Request a signed upload URL for a new backup
   */
  async requestSignedUploadUrl(params: {
    projectName: string;
    sizeBytes: number;
    sha256: string;
    appVersion?: string;
    notes?: string;
  }): Promise<SignedUploadResponse> {
    logger.info(`Requesting signed upload URL for project: ${params.projectName}`);
    return this.callEdgeFunction<SignedUploadResponse>(
      "vault-signed-upload",
      "POST",
      params
    );
  }

  /**
   * Upload a file to Supabase Storage using signed URL
   */
  async uploadFile(signedUrl: string, filePath: string): Promise<void> {
    logger.info(`Uploading file to signed URL: ${filePath}`);

    const fileBuffer = await fs.readFile(filePath);

    const response = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/zip",
      },
      body: new Uint8Array(fileBuffer),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error(`Upload failed: ${response.status} - ${errorText}`);
      throw new Error(`Upload failed: ${response.status}`);
    }

    logger.info("File uploaded successfully");
  }

  /**
   * Confirm that an upload has completed
   */
  async confirmUpload(backupId: string): Promise<void> {
    logger.info(`Confirming upload for backup: ${backupId}`);
    await this.callEdgeFunction<{ success: boolean }>(
      "vault-confirm-upload",
      "POST",
      { backupId }
    );
    logger.info("Upload confirmed");
  }

  /**
   * Request a signed download URL for a backup
   */
  async requestSignedDownloadUrl(
    backupId: string
  ): Promise<SignedDownloadResponse> {
    logger.info(`Requesting signed download URL for backup: ${backupId}`);
    return this.callEdgeFunction<SignedDownloadResponse>(
      "vault-signed-download",
      "POST",
      { backupId }
    );
  }

  /**
   * Download a file from Supabase Storage using signed URL
   */
  async downloadFile(signedUrl: string, outputPath: string): Promise<void> {
    logger.info(`Downloading file to: ${outputPath}`);

    const response = await fetch(signedUrl);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      logger.error(`Download failed: ${response.status} - ${errorText}`);
      throw new Error(`Download failed: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(outputPath, Buffer.from(arrayBuffer));

    logger.info("File downloaded successfully");
  }

  /**
   * List all backups for the current user
   */
  async listBackups(): Promise<VaultBackup[]> {
    logger.info("Listing backups");
    const response = await this.callEdgeFunction<{ backups: VaultBackup[] }>(
      "vault-list-backups",
      "GET"
    );
    return response.backups;
  }

  /**
   * Delete a backup
   */
  async deleteBackup(backupId: string): Promise<void> {
    logger.info(`Deleting backup: ${backupId}`);
    await this.callEdgeFunction<{ success: boolean }>(
      "vault-delete-backup",
      "POST",
      { backupId }
    );
    logger.info("Backup deleted");
  }

  /**
   * Complete backup flow: export project, upload, and confirm
   */
  async createBackup(params: {
    projectName: string;
    projectPath: string;
    appVersion: string;
    notes?: string;
    onProgress?: (stage: string, progress: number) => void;
  }): Promise<VaultBackup> {
    const { projectName, projectPath, appVersion, notes, onProgress } = params;

    onProgress?.("Preparing export...", 0);

    // Import zip utilities
    const { exportProjectToZip, getTempZipPath, cleanupTempZip } = await import(
      "./vault_zip"
    );

    // Create temporary zip file
    const tempZipPath = getTempZipPath(projectName);

    try {
      // Export project to zip
      onProgress?.("Exporting project...", 10);
      const { sha256, sizeBytes } = await exportProjectToZip(
        projectPath,
        tempZipPath
      );

      // Request signed upload URL
      onProgress?.("Preparing upload...", 30);
      const uploadInfo = await this.requestSignedUploadUrl({
        projectName,
        sizeBytes,
        sha256,
        appVersion,
        notes,
      });

      // Upload to storage
      onProgress?.("Uploading...", 50);
      await this.uploadFile(uploadInfo.signedUrl, tempZipPath);

      // Confirm upload
      onProgress?.("Confirming...", 90);
      await this.confirmUpload(uploadInfo.backupId);

      onProgress?.("Complete!", 100);

      // Return backup info
      return {
        id: uploadInfo.backupId,
        projectName,
        sizeBytes,
        sha256,
        status: "uploaded",
        createdAt: new Date().toISOString(),
        appVersion,
        notes: notes || null,
      };
    } finally {
      // Clean up temp file
      await cleanupTempZip(tempZipPath);
    }
  }

  /**
   * Complete restore flow: download and extract
   */
  async restoreBackup(params: {
    backupId: string;
    targetPath: string;
    onProgress?: (stage: string, progress: number) => void;
  }): Promise<void> {
    const { backupId, targetPath, onProgress } = params;

    onProgress?.("Preparing download...", 0);

    // Import zip utilities
    const { importProjectFromZip, getTempZipPath, cleanupTempZip } =
      await import("./vault_zip");

    // Request signed download URL
    onProgress?.("Getting download URL...", 10);
    const downloadInfo = await this.requestSignedDownloadUrl(backupId);

    // Create temp path for download
    const tempZipPath = getTempZipPath(downloadInfo.projectName);

    try {
      // Download from storage
      onProgress?.("Downloading...", 30);
      await this.downloadFile(downloadInfo.signedUrl, tempZipPath);

      // Extract to target path
      onProgress?.("Extracting...", 70);
      await importProjectFromZip(
        tempZipPath,
        targetPath,
        downloadInfo.sha256 || undefined
      );

      onProgress?.("Complete!", 100);
    } finally {
      // Clean up temp file
      await cleanupTempZip(tempZipPath);
    }
  }
}

/**
 * Create a VaultClient instance with default configuration
 * Note: In production, these values should come from environment or settings
 */
export function createVaultClient(config: VaultClientConfig): VaultClient {
  return new VaultClient(config);
}
