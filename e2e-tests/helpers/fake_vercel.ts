import { expect, type APIRequestContext } from "@playwright/test";
import type { FakeVercelState } from "../../testing/fake-llm-server/vercel";

/** Controls the worker-local Vercel fake without changing renderer or IPC code. */
export class FakeVercel {
  private baseUrl: string;

  constructor(
    private request: APIRequestContext,
    port: number,
  ) {
    this.baseUrl = `http://localhost:${port}/vercel/test`;
  }

  async reset() {
    const response = await this.request.post(`${this.baseUrl}/reset`);
    expect(response.ok()).toBe(true);
  }

  async getState(): Promise<FakeVercelState> {
    const response = await this.request.get(`${this.baseUrl}/state`);
    expect(response.ok()).toBe(true);
    return response.json();
  }

  async setBuildState(id: string, readyState: "READY" | "ERROR") {
    const response = await this.request.post(
      `${this.baseUrl}/deployment-state`,
      {
        data: { id, readyState },
      },
    );
    expect(response.ok()).toBe(true);
  }
}
