/**
 * Cloud Sandbox Provider Interface
 *
 * Defines the contract for cloud sandbox providers (Vercel, CodeSandbox, StackBlitz, etc.)
 * This abstraction allows for swapping providers in the future without changing the core app logic.
 */

export interface FileMap {
  [relativePath: string]: string;
}

export interface CloudSandboxInfo {
  sandboxId: string;
  previewUrl: string;
}

export interface CloudSandboxProvider {
  /**
   * Provider name (e.g., "vercel", "codesandbox")
   */
  name: string;

  /**
   * Creates a new sandbox and uploads the initial files
   * @param appPath Local path to the app directory
   * @param appId The Dyad app ID
   * @returns Sandbox ID and preview URL
   */
  createSandbox(appPath: string, appId: number): Promise<CloudSandboxInfo>;

  /**
   * Destroys/terminates a sandbox
   * @param sandboxId The sandbox ID to destroy
   */
  destroySandbox(sandboxId: string): Promise<void>;

  /**
   * Gets the current status of a sandbox
   * @param sandboxId The sandbox ID to check
   * @returns Status information
   */
  getSandboxStatus(sandboxId: string): Promise<{
    status: "running" | "stopped" | "error" | "unknown";
    previewUrl?: string;
  }>;

  /**
   * Uploads files to an existing sandbox
   * @param sandboxId The sandbox ID
   * @param files Map of relative paths to file contents
   */
  uploadFiles(sandboxId: string, files: FileMap): Promise<void>;

  /**
   * Streams logs from a sandbox
   * @param sandboxId The sandbox ID
   * @returns AsyncIterable of log strings
   */
  streamLogs(sandboxId: string): AsyncIterable<string>;
}

/**
 * Dyad Engine-backed cloud sandbox provider
 *
 * This provider communicates with Dyad Engine (backend) which manages
 * Vercel Sandbox SDK credentials and API calls on behalf of Pro users.
 */
export class DyadEngineCloudSandboxProvider implements CloudSandboxProvider {
  name = "dyad-engine";

  private baseUrl: string;
  private authToken: string | null = null;

  constructor(baseUrl: string = "https://api.dyad.sh") {
    this.baseUrl = baseUrl;
  }

  setAuthToken(token: string) {
    this.authToken = token;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.authToken) {
      throw new Error("Cloud sandbox requires Dyad Pro authentication");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.authToken}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Cloud sandbox API error: ${response.status} - ${errorText}`,
      );
    }

    return response.json() as T;
  }

  async createSandbox(
    appPath: string,
    appId: number,
  ): Promise<CloudSandboxInfo> {
    // For MVP, we'll create a sandbox via Dyad Engine
    // The engine will handle Vercel SDK calls server-side
    const result = await this.request<CloudSandboxInfo>(
      "POST",
      "/api/sandboxes",
      {
        appId,
        appPath,
      },
    );

    return result;
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    await this.request("DELETE", `/api/sandboxes/${sandboxId}`);
  }

  async getSandboxStatus(sandboxId: string): Promise<{
    status: "running" | "stopped" | "error" | "unknown";
    previewUrl?: string;
  }> {
    return this.request("GET", `/api/sandboxes/${sandboxId}/status`);
  }

  async uploadFiles(sandboxId: string, files: FileMap): Promise<void> {
    await this.request("POST", `/api/sandboxes/${sandboxId}/files`, { files });
  }

  async *streamLogs(sandboxId: string): AsyncIterable<string> {
    if (!this.authToken) {
      throw new Error("Cloud sandbox requires Dyad Pro authentication");
    }

    // Use Server-Sent Events for log streaming
    const response = await fetch(
      `${this.baseUrl}/api/sandboxes/${sandboxId}/logs`,
      {
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          Accept: "text/event-stream",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to stream logs: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body for log stream");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          yield line.slice(6);
        }
      }
    }
  }
}

// Singleton instance
let cloudSandboxProvider: CloudSandboxProvider | null = null;

export function getCloudSandboxProvider(): CloudSandboxProvider {
  if (!cloudSandboxProvider) {
    cloudSandboxProvider = new DyadEngineCloudSandboxProvider();
  }
  return cloudSandboxProvider;
}

export function setCloudSandboxProvider(provider: CloudSandboxProvider): void {
  cloudSandboxProvider = provider;
}
