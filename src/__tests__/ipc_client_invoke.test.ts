import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the window.electron object before importing IpcClient
const mockInvoke = vi.fn();
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();

// Set up the mock before any imports that use window.electron
(global as any).window = {
  electron: {
    ipcRenderer: {
      invoke: mockInvoke,
      on: mockOn,
      removeListener: mockRemoveListener,
    },
  },
};

// Now we can import IpcClient
import { IpcClient } from "../ipc/ipc_client";

describe("IpcClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("invoke method", () => {
    it("should have an invoke method", () => {
      const client = IpcClient.getInstance();
      expect(typeof client.invoke).toBe("function");
    });

    it("should forward invoke calls to ipcRenderer.invoke", async () => {
      const client = IpcClient.getInstance();
      mockInvoke.mockResolvedValueOnce({ success: true });

      const result = await client.invoke("test-channel", { foo: "bar" });

      expect(mockInvoke).toHaveBeenCalledWith("test-channel", { foo: "bar" });
      expect(result).toEqual({ success: true });
    });

    it("should work without arguments", async () => {
      const client = IpcClient.getInstance();
      mockInvoke.mockResolvedValueOnce("result");

      const result = await client.invoke("test-channel");

      expect(mockInvoke).toHaveBeenCalledWith("test-channel", undefined);
      expect(result).toBe("result");
    });

    it("should support vault IPC channels", async () => {
      const client = IpcClient.getInstance();

      // Test vault:get-settings
      mockInvoke.mockResolvedValueOnce({
        supabaseUrl: "https://test.supabase.co",
        hasAnonKey: true,
        maskedAnonKey: "***...abc123",
      });

      const settings = await client.invoke("vault:get-settings");
      expect(mockInvoke).toHaveBeenCalledWith("vault:get-settings", undefined);
      expect(settings).toHaveProperty("supabaseUrl");

      // Test vault:test-connection
      mockInvoke.mockResolvedValueOnce({
        success: true,
        status: "connected",
        message: "Connected successfully",
      });

      const testResult = await client.invoke("vault:test-connection");
      expect(mockInvoke).toHaveBeenCalledWith(
        "vault:test-connection",
        undefined,
      );
      expect(testResult).toHaveProperty("status");
    });

    it("should propagate errors from ipcRenderer", async () => {
      const client = IpcClient.getInstance();
      mockInvoke.mockRejectedValueOnce(new Error("IPC error"));

      await expect(client.invoke("test-channel")).rejects.toThrow("IPC error");
    });
  });
});
