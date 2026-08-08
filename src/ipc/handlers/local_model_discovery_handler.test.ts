import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverLocalModelServers,
  isPrivateIpv4,
} from "./local_model_discovery_handler";

describe("local model server discovery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("limits automatic scanning to private IPv4 ranges", () => {
    expect(isPrivateIpv4("10.2.3.4")).toBe(true);
    expect(isPrivateIpv4("172.20.1.5")).toBe(true);
    expect(isPrivateIpv4("192.168.1.8")).toBe(true);
    expect(isPrivateIpv4("8.8.8.8")).toBe(false);
    expect(isPrivateIpv4("172.40.1.5")).toBe(false);
  });

  it("discovers a manually entered Ollama server and its metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "http://192.168.1.20:11434/api/tags") {
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: "qwen2.5-coder:7b",
                  size: 4_200_000_000,
                  details: {
                    parameter_size: "7B",
                    quantization_level: "Q4_K_M",
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        throw new TypeError("offline");
      }),
    );

    const result = await discoverLocalModelServers({
      scanLocalSubnet: false,
      targets: ["192.168.1.20:11434"],
    });

    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]).toMatchObject({
      provider: "ollama",
      host: "192.168.1.20",
      port: 11434,
    });
    expect(result.servers[0].models[0]).toMatchObject({
      modelName: "qwen2.5-coder:7b",
      parameterSize: "7B",
      quantization: "Q4_K_M",
    });
  });
});
