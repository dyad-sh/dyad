import { parseOllamaHost } from "@/ipc/handlers/local_model_ollama_handler";
import { describe, it, expect } from "vitest";

describe("parseOllamaHost", () => {
  it("should return default URL when no host is provided", () => {
    const result = parseOllamaHost();
    expect(result).toBe("http://localhost:11434");
  });

  it("should return default URL when host is undefined", () => {
    const result = parseOllamaHost(undefined);
    expect(result).toBe("http://localhost:11434");
  });

  it("should return default URL when host is empty string", () => {
    const result = parseOllamaHost("");
    expect(result).toBe("http://localhost:11434");
  });

  describe("full URLs with protocol", () => {
    it("should return http URLs as-is", () => {
      const input = "http://localhost:11434";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://localhost:11434");
    });

    it("should return https URLs as-is", () => {
      const input = "https://example.com:11434";
      const result = parseOllamaHost(input);
      expect(result).toBe("https://example.com:11434");
    });

    it("should return http URLs with custom ports as-is", () => {
      const input = "http://192.168.1.100:8080";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://192.168.1.100:8080");
    });

    it("should return https URLs with paths as-is", () => {
      const input = "https://api.example.com:443/ollama";
      const result = parseOllamaHost(input);
      expect(result).toBe("https://api.example.com:443/ollama");
    });
  });

  describe("hostname with port", () => {
    it("should add http protocol to IPv4 host with port", () => {
      const input = "192.168.1.100:8080";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://192.168.1.100:8080");
    });

    it("should add http protocol to localhost with custom port", () => {
      const input = "localhost:8080";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://localhost:8080");
    });

    it("should add http protocol to domain with port", () => {
      const input = "ollama.example.com:11434";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://ollama.example.com:11434");
    });

    it("should add http protocol to 0.0.0.0 with port", () => {
      const input = "0.0.0.0:1234";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://0.0.0.0:1234");
    });

    it("should handle IPv6 with port", () => {
      const input = "[::1]:8080";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://[::1]:8080");
    });
  });

  describe("hostname only", () => {
    it("should add http protocol and default port to IPv4 host", () => {
      const input = "192.168.1.100";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://192.168.1.100:11434");
    });

    it("should add http protocol and default port to localhost", () => {
      const input = "localhost";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://localhost:11434");
    });

    it("should add http protocol and default port to domain", () => {
      const input = "ollama.example.com";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://ollama.example.com:11434");
    });

    it("should add http protocol and default port to 0.0.0.0", () => {
      const input = "0.0.0.0";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://0.0.0.0:11434");
    });

    it("should handle IPv6 hostname", () => {
      const input = "::1";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://[::1]:11434");
    });

    it("should handle full IPv6 hostname", () => {
      const input = "2001:db8:85a3:0:0:8a2e:370:7334";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://[2001:db8:85a3:0:0:8a2e:370:7334]:11434");
    });

    it("should handle compressed IPv6 hostname", () => {
      const input = "2001:db8::1";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://[2001:db8::1]:11434");
    });
  });

  describe("edge cases", () => {
    it("should handle hostname with unusual characters", () => {
      const input = "my-ollama-server";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://my-ollama-server:11434");
    });

    it("should handle hostname with dots", () => {
      const input = "my.ollama.server";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://my.ollama.server:11434");
    });

    it("should handle port 80", () => {
      const input = "example.com:80";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://example.com:80");
    });

    it("should handle port 443", () => {
      const input = "example.com:443";
      const result = parseOllamaHost(input);
      expect(result).toBe("http://example.com:443");
    });
  });
});
