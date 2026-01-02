/**
 * Scraper & Dataset IPC Client
 * Renderer-side API for web scraping and dataset management
 */

import type { IpcRenderer } from "electron";
import type {
  ScrapingConfig,
  ScrapingJob,
  ScraperStatus,
  Dataset,
  DatasetPreview,
  DatasetExportOptions,
  ScrapingTemplate,
  ScrapingField,
} from "@/types/scraper_types";

let ipcRenderer: IpcRenderer | null = null;

function getIpcRenderer(): IpcRenderer {
  if (!ipcRenderer) {
    ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      throw new Error("IPC not available - are you running in Electron?");
    }
  }
  return ipcRenderer;
}

/**
 * Scraper client for renderer process
 */
export class ScraperClient {
  private static instance: ScraperClient;

  private constructor() {}

  static getInstance(): ScraperClient {
    if (!ScraperClient.instance) {
      ScraperClient.instance = new ScraperClient();
    }
    return ScraperClient.instance;
  }

  // ============= Status =============

  /**
   * Get scraper system status
   */
  async getStatus(): Promise<ScraperStatus> {
    return getIpcRenderer().invoke("scraper:status");
  }

  // ============= Scraping Configs =============

  /**
   * List all scraping configurations
   */
  async listConfigs(): Promise<ScrapingConfig[]> {
    return getIpcRenderer().invoke("scraper:config:list");
  }

  /**
   * Save a scraping configuration
   */
  async saveConfig(config: Partial<ScrapingConfig>): Promise<ScrapingConfig> {
    return getIpcRenderer().invoke("scraper:config:save", config);
  }

  /**
   * Delete a scraping configuration
   */
  async deleteConfig(configId: string): Promise<void> {
    return getIpcRenderer().invoke("scraper:config:delete", configId);
  }

  /**
   * Get built-in scraping templates
   */
  async getTemplates(): Promise<ScrapingTemplate[]> {
    return getIpcRenderer().invoke("scraper:templates");
  }

  // ============= Scraping Jobs =============

  /**
   * Start a new scraping job
   */
  async startJob(configId: string): Promise<ScrapingJob> {
    return getIpcRenderer().invoke("scraper:job:start", configId);
  }

  /**
   * Get job status
   */
  async getJobStatus(jobId: string): Promise<ScrapingJob | null> {
    return getIpcRenderer().invoke("scraper:job:status", jobId);
  }

  /**
   * List all jobs
   */
  async listJobs(): Promise<ScrapingJob[]> {
    return getIpcRenderer().invoke("scraper:job:list");
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<void> {
    return getIpcRenderer().invoke("scraper:job:cancel", jobId);
  }

  // ============= Datasets =============

  /**
   * List all datasets
   */
  async listDatasets(): Promise<Dataset[]> {
    return getIpcRenderer().invoke("scraper:dataset:list");
  }

  /**
   * Get a specific dataset
   */
  async getDataset(datasetId: string): Promise<Dataset | null> {
    return getIpcRenderer().invoke("scraper:dataset:get", datasetId);
  }

  /**
   * Preview dataset contents
   */
  async previewDataset(datasetId: string, limit: number = 100): Promise<DatasetPreview> {
    return getIpcRenderer().invoke("scraper:dataset:preview", datasetId, limit);
  }

  /**
   * Export dataset to file
   */
  async exportDataset(datasetId: string, options: DatasetExportOptions): Promise<string> {
    return getIpcRenderer().invoke("scraper:dataset:export", datasetId, options);
  }

  /**
   * Delete a dataset
   */
  async deleteDataset(datasetId: string): Promise<void> {
    return getIpcRenderer().invoke("scraper:dataset:delete", datasetId);
  }

  /**
   * Create dataset from manual input
   */
  async createDataset(params: {
    name: string;
    description?: string;
    data: Record<string, any>[];
    format?: "json" | "csv";
  }): Promise<Dataset> {
    return getIpcRenderer().invoke("scraper:dataset:create", params);
  }

  /**
   * Import dataset from file
   */
  async importDataset(filePath: string): Promise<Dataset> {
    return getIpcRenderer().invoke("scraper:dataset:import", filePath);
  }

  // ============= Quick Scrape =============

  /**
   * Quick scrape a single URL
   */
  async quickScrape(url: string, fields: ScrapingField[]): Promise<Record<string, any>> {
    return getIpcRenderer().invoke("scraper:quick-scrape", url, fields);
  }
}

// Export singleton
export const scraperClient = ScraperClient.getInstance();
