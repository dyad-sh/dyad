import { describe, expect, test } from "vitest";

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
} from "@ai-sdk/provider";

import type { UserSettings } from "../../lib/schemas";
import { createDyadEngine } from "./llm_engine_provider";

describe("createDyadEngine", () => {
  test("uses Anthropic messages API for Anthropic engine models", async () => {
    const requests: Array<{
      input: RequestInfo | URL;
      init?: RequestInit;
    }> = [];

    const provider = createDyadEngine({
      apiKey: "dyad-pro-key",
      baseURL: "https://engine.example.test/v1",
      dyadOptions: {
        enableLazyEdits: true,
        enableSmartFilesContext: true,
        enableWebSearch: false,
      },
      settings: {
        thinkingBudget: "medium",
      } as UserSettings,
      fetch: async (input, init) => {
        requests.push({ input, init });

        return new Response(
          JSON.stringify({
            type: "message",
            id: "msg_123",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "ok", citations: [] }],
            stop_reason: "end_turn",
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const model = provider.anthropic("claude-sonnet-4-20250514", {
      providerId: "anthropic",
    }) as LanguageModelV3;

    await model.doGenerate({
      prompt: [
        { role: "system", content: "You are concise." },
        { role: "user", content: [{ type: "text", text: "Hello" }] },
      ],
      providerOptions: {
        "dyad-engine": {
          dyadAppId: 42,
          dyadAppUuid: "00000000-0000-4000-8000-000000000042",
          dyadAppName: "Test App",
          dyadChatId: 7,
          dyadTurnUuid: "00000000-0000-4000-8000-000000000007",
          dyadRequestId: "request-1",
          dyadFiles: [{ path: "src/App.tsx", content: "export {}" }],
        },
      },
    } satisfies LanguageModelV3CallOptions);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(String(request.input)).toBe(
      "https://engine.example.test/v1/messages",
    );
    expect(request.init?.headers).toMatchObject({
      authorization: "Bearer dyad-pro-key",
      "X-Dyad-Request-Id": "request-1:attempt-1",
    });

    const body = JSON.parse(String(request.init?.body));
    expect(body).toMatchObject({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      system: [{ type: "text", text: "You are concise." }],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "medium" },
      dyad_options: {
        app_id: 42,
        app_uuid: "00000000-0000-4000-8000-000000000042",
        app_name: "Test App",
        chat_id: 7,
        turn_uuid: "00000000-0000-4000-8000-000000000007",
        enable_lazy_edits: true,
        enable_smart_files_context: true,
        enable_web_search: false,
        files: [{ path: "src/App.tsx", content: "export {}" }],
      },
    });
    expect(body).not.toHaveProperty("dyadAppId");
    expect(body).not.toHaveProperty("dyadAppUuid");
    expect(body).not.toHaveProperty("dyadAppName");
    expect(body).not.toHaveProperty("dyadChatId");
    expect(body).not.toHaveProperty("dyadTurnUuid");
    expect(body).not.toHaveProperty("dyadRequestId");
    expect(body).not.toHaveProperty("dyadFiles");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  test("applies query params to Anthropic engine requests", async () => {
    const requests: Array<{
      input: RequestInfo | URL;
      init?: RequestInit;
    }> = [];

    const provider = createDyadEngine({
      apiKey: "dyad-pro-key",
      baseURL: "https://engine.example.test/v1",
      queryParams: {
        feature: "anthropic-direct",
        source: "test",
      },
      dyadOptions: {},
      settings: {} as UserSettings,
      fetch: async (input, init) => {
        requests.push({ input, init });

        return new Response(
          JSON.stringify({
            type: "message",
            id: "msg_123",
            model: "claude-sonnet-4-20250514",
            content: [{ type: "text", text: "ok", citations: [] }],
            stop_reason: "end_turn",
            usage: {
              input_tokens: 1,
              output_tokens: 1,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const model = provider.anthropic("claude-sonnet-4-20250514", {
      providerId: "anthropic",
    }) as LanguageModelV3;

    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    } satisfies LanguageModelV3CallOptions);

    expect(requests).toHaveLength(1);
    const url = new URL(String(requests[0].input));
    expect(url.origin + url.pathname).toBe(
      "https://engine.example.test/v1/messages",
    );
    expect(url.searchParams.get("feature")).toBe("anthropic-direct");
    expect(url.searchParams.get("source")).toBe("test");
  });

  test("keeps app metadata when file injection is disabled", async () => {
    const requests: Array<{
      input: RequestInfo | URL;
      init?: RequestInit;
    }> = [];

    const provider = createDyadEngine({
      apiKey: "dyad-pro-key",
      baseURL: "https://engine.example.test/v1",
      dyadOptions: {
        enableLazyEdits: true,
        enableSmartFilesContext: true,
        enableWebSearch: true,
      },
      settings: {} as UserSettings,
      fetch: async (input, init) => {
        requests.push({ input, init });

        return new Response(
          JSON.stringify({
            id: "chatcmpl_123",
            object: "chat.completion",
            created: 1,
            model: "gpt-5",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const model = provider.chatModel("gpt-5", {
      providerId: "openai",
    }) as LanguageModelV3;

    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: {
        "dyad-engine": {
          dyadAppId: 42,
          dyadAppUuid: "00000000-0000-4000-8000-000000000042",
          dyadAppName: "Test App",
          dyadChatId: 7,
          dyadTurnUuid: "00000000-0000-4000-8000-000000000007",
          dyadRequestId: "request-1",
          dyadFiles: [{ path: "src/App.tsx", content: "export {}" }],
          dyadDisableFiles: true,
        },
      },
    } satisfies LanguageModelV3CallOptions);

    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.dyad_options).toEqual({
      app_id: 42,
      app_uuid: "00000000-0000-4000-8000-000000000042",
      app_name: "Test App",
      chat_id: 7,
      turn_uuid: "00000000-0000-4000-8000-000000000007",
    });
    expect(body.dyad_options).not.toHaveProperty("files");
    expect(body.dyad_options).not.toHaveProperty("enable_smart_files_context");
  });

  test("sends stable free quota key separately from attempt request id", async () => {
    const requests: Array<{
      input: RequestInfo | URL;
      init?: RequestInit;
    }> = [];

    const provider = createDyadEngine({
      apiKey: "dyad-pro-key",
      baseURL: "https://engine.example.test/v1",
      dyadOptions: {},
      settings: {} as UserSettings,
      fetch: async (input, init) => {
        requests.push({ input, init });

        return new Response(
          JSON.stringify({
            id: "chatcmpl_123",
            object: "chat.completion",
            created: 1,
            model: "free-pro",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 1,
              completion_tokens: 1,
              total_tokens: 2,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    const model = provider.freeChatModel("free-pro", {
      providerId: "auto",
    }) as LanguageModelV3;

    await model.doGenerate({
      prompt: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      providerOptions: {
        "dyad-engine": {
          dyadRequestId: "visible-turn-1",
        },
      },
    } satisfies LanguageModelV3CallOptions);

    expect(requests).toHaveLength(1);
    expect(String(requests[0].input)).toBe(
      "https://engine.example.test/v1/free/chat/completions",
    );
    expect(requests[0].init?.headers).toMatchObject({
      "X-Dyad-Request-Id": "visible-turn-1:attempt-1",
      "X-Dyad-Free-Quota-Key": "visible-turn-1",
    });
  });
});
