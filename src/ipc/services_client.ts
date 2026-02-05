/**
 * External Services IPC Client
 * 
 * Renderer-side client for managing external services like n8n and Celestia.
 */

import type { IpcRenderer } from "electron";

export type ServiceId = "n8n" | "celestia" | "ollama";

export interface ServiceStatus {
  id: ServiceId;
  name: string;
  running: boolean;
  pid?: number;
  startedAt?: number;
  port?: number;
  error?: string;
}

export interface ServiceConfig {
  id: ServiceId;
  name: string;
  description: string;
  port?: number;
  scriptPath?: string;
  dockerCompose?: string;
  useWSL?: boolean;
  healthCheckUrl?: string;
}

class ServicesClient {
  private static instance: ServicesClient;
  private ipcRenderer: IpcRenderer;

  private constructor() {
    this.ipcRenderer = (window as any).electron.ipcRenderer as IpcRenderer;
  }

  static getInstance(): ServicesClient {
    if (!ServicesClient.instance) {
      ServicesClient.instance = new ServicesClient();
    }
    return ServicesClient.instance;
  }

  /**
   * Get list of all available services
   */
  async listServices(): Promise<ServiceConfig[]> {
    return this.ipcRenderer.invoke("services:list");
  }

  /**
   * Get status of all services
   */
  async getAllStatus(): Promise<ServiceStatus[]> {
    return this.ipcRenderer.invoke("services:status:all");
  }

  /**
   * Get status of a specific service
   */
  async getStatus(serviceId: ServiceId): Promise<ServiceStatus> {
    return this.ipcRenderer.invoke("services:status", serviceId);
  }

  /**
   * Start a service
   */
  async startService(serviceId: ServiceId): Promise<ServiceStatus> {
    return this.ipcRenderer.invoke("services:start", serviceId);
  }

  /**
   * Stop a service
   */
  async stopService(serviceId: ServiceId): Promise<ServiceStatus> {
    return this.ipcRenderer.invoke("services:stop", serviceId);
  }

  /**
   * Restart a service
   */
  async restartService(serviceId: ServiceId): Promise<ServiceStatus> {
    return this.ipcRenderer.invoke("services:restart", serviceId);
  }

  /**
   * Start all services
   */
  async startAllServices(): Promise<ServiceStatus[]> {
    return this.ipcRenderer.invoke("services:start:all");
  }

  /**
   * Stop all services
   */
  async stopAllServices(): Promise<ServiceStatus[]> {
    return this.ipcRenderer.invoke("services:stop:all");
  }
}

export const servicesClient = ServicesClient.getInstance();
export default ServicesClient;
