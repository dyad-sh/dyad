import { z } from "zod";
import {
  defineContract,
  defineStream,
  createClient,
  createStreamClient,
} from "../contracts/core";

export const ChatAgentStartParamsSchema = z.object({
  sessionId: z.string(),
  message: z.string().optional(),
  /** Saved UI transcript used to restore a conversation after app restart. */
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .max(200)
    .optional(),
  /** Optional built-in agent profile that constrains the available tools. */
  agentProfile: z.enum(["lovable-web-dev"]).optional(),
  /** Per-turn MCP tool keys selected from the Chat Agent tool menu. */
  selectedMcpToolKeys: z.array(z.string()).optional(),
  /** Per-turn MCP workflow keys selected from the Chat Agent tool menu. */
  selectedMcpWorkflowKeys: z.array(z.string()).optional(),
  /** Explicitly selected local Vector collections for retrieval this turn. */
  vectorCollectionIds: z.array(z.string()).max(20).optional(),
  /** Data sources the user ticked; the agent may reach no others. */
  dataSourceIds: z.array(z.string()).max(20).optional(),
  /** When true, re-run the last user turn (drops the latest assistant reply). */
  regenerate: z.boolean().optional(),
});

export type ChatAgentStartParams = z.infer<typeof ChatAgentStartParamsSchema>;

const WebSearchPresentationSchema = z.object({
  kind: z.literal("web-search"),
  query: z.string(),
  abstract: z.string().optional(),
  searchUrl: z.string().url(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
      source: z.string().optional(),
      displayUrl: z.string().optional(),
      favicon: z.string().url().optional(),
      publishedAt: z.string().optional(),
    }),
  ),
});

const CryptoMarketPresentationSchema = z.object({
  kind: z.literal("crypto-market"),
  query: z.string(),
  currency: z.string(),
  coins: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      symbol: z.string(),
      image: z.string().url().optional(),
      price: z.number(),
      change24h: z.number().optional(),
      marketCap: z.number().optional(),
      volume24h: z.number().optional(),
    }),
  ),
});

const PlacePresentationSchema = z.object({
  id: z.string(),
  name: z.string(),
  admin1: z.string().optional(),
  country: z.string().optional(),
  countryCode: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  elevation: z.number().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});

const WeatherForecastPresentationSchema = z.object({
  kind: z.literal("weather-forecast"),
  location: PlacePresentationSchema,
  timezone: z.string().optional(),
  current: z.object({
    time: z.string(),
    temperature: z.number(),
    apparentTemperature: z.number().optional(),
    humidity: z.number().optional(),
    precipitation: z.number().optional(),
    weatherCode: z.number(),
    windSpeed: z.number().optional(),
    windDirection: z.number().optional(),
    windGusts: z.number().optional(),
    isDay: z.boolean(),
  }),
  units: z.object({
    temperature: z.string(),
    precipitation: z.string(),
    windSpeed: z.string(),
  }),
  daily: z.array(
    z.object({
      date: z.string(),
      weatherCode: z.number(),
      temperatureMax: z.number(),
      temperatureMin: z.number(),
      precipitationProbability: z.number().optional(),
      precipitationSum: z.number().optional(),
      windSpeedMax: z.number().optional(),
      sunrise: z.string().optional(),
      sunset: z.string().optional(),
    }),
  ),
  source: z.string(),
});

const MapPlacesPresentationSchema = z.object({
  kind: z.literal("map-places"),
  query: z.string(),
  style: z.enum(["dark", "liberty", "positron"]),
  styleUrl: z.string().url(),
  provider: z.string(),
  places: z.array(PlacePresentationSchema),
});

const FlightSearchPresentationSchema = z.object({
  kind: z.literal("flight-search"),
  provider: z.string().optional(),
  origin: z.string(),
  destination: z.string(),
  departureDate: z.string(),
  returnDate: z.string().optional(),
  flexibleMonth: z.string().optional(),
  tripLengthNights: z.number().optional(),
  adults: z.number().optional(),
  cabinClass: z.string().optional(),
  currency: z.string(),
  searchUrl: z.string().url().optional(),
  searchOptions: z
    .array(
      z.object({
        departureDate: z.string(),
        returnDate: z.string().optional(),
        searchUrl: z.string().url(),
      }),
    )
    .optional(),
  notice: z.string().optional(),
  itineraries: z.array(
    z.object({
      id: z.string(),
      price: z.number(),
      deepLink: z.string().url().optional(),
      legs: z.array(
        z.object({
          origin: z.string(),
          destination: z.string(),
          departure: z.string(),
          arrival: z.string(),
          durationMinutes: z.number(),
          stopCount: z.number(),
          carriers: z.array(z.string()),
        }),
      ),
    }),
  ),
});

const LovableProjectsPresentationSchema = z.object({
  kind: z.literal("lovable-projects"),
  toolName: z.string(),
  heading: z.string(),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      workspace: z.string().optional(),
      screenshotUrl: z.string().url().optional(),
      previewUrl: z.string().url().optional(),
      editorUrl: z.string().url().optional(),
      publishedUrl: z.string().url().optional(),
      status: z.string().optional(),
      visibility: z.string().optional(),
      updatedAt: z.string().optional(),
    }),
  ),
});

export const ChatAgentToolPresentationSchema = z.discriminatedUnion("kind", [
  WebSearchPresentationSchema,
  CryptoMarketPresentationSchema,
  WeatherForecastPresentationSchema,
  MapPlacesPresentationSchema,
  FlightSearchPresentationSchema,
  LovableProjectsPresentationSchema,
]);
export type ChatAgentToolPresentation = z.infer<
  typeof ChatAgentToolPresentationSchema
>;

export const ChatAgentToolResultSchema = z.object({
  serverName: z.string(),
  toolName: z.string(),
  result: z.string(),
  status: z.enum(["running", "completed", "error"]).default("completed"),
  presentation: ChatAgentToolPresentationSchema.optional(),
});

export const ChatAgentToolActivitySchema = z.object({
  toolName: z.string(),
  status: z.enum(["running", "completed", "error"]),
});

/**
 * A passage location selected by local RAG for an assistant answer.
 *
 * This travels separately from the model's prose so the UI can always show a
 * trustworthy, openable source even when the model omits an inline citation.
 */
export const ChatAgentRagSourceSchema = z.object({
  collectionId: z.string(),
  collectionName: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourcePath: z.string(),
  page: z.number().int().positive().nullish(),
  lineStart: z.number().int().positive().nullish(),
  lineEnd: z.number().int().positive().nullish(),
});
export type ChatAgentRagSource = z.infer<typeof ChatAgentRagSourceSchema>;

export const ChatAgentChunkSchema = z
  .object({
    sessionId: z.string(),
    delta: z.string().optional(),
    toolResult: ChatAgentToolResultSchema.optional(),
    toolActivity: ChatAgentToolActivitySchema.optional(),
    ragSources: z.array(ChatAgentRagSourceSchema).optional(),
  })
  .refine(
    (value) =>
      value.delta != null ||
      value.toolResult != null ||
      value.toolActivity != null ||
      value.ragSources != null,
    {
      message: "Expected a delta, tool result, tool activity, or RAG sources",
    },
  );

export const ChatAgentEndSchema = z.object({
  sessionId: z.string(),
});

export const ChatAgentErrorSchema = z.object({
  sessionId: z.string(),
  error: z.string(),
});

export const ChatAgentEnhancePromptParamsSchema = z.object({
  prompt: z.string(),
});

export const chatAgentContracts = {
  start: defineContract({
    channel: "chat-agent:start",
    input: ChatAgentStartParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  enhancePrompt: defineContract({
    channel: "chat-agent:enhance-prompt",
    input: ChatAgentEnhancePromptParamsSchema,
    output: z.object({ enhanced: z.string() }),
  }),

  cancel: defineContract({
    channel: "chat-agent:cancel",
    input: z.string(),
    output: z.object({ ok: z.literal(true) }),
  }),
} as const;

export const chatAgentStreamContract = defineStream({
  channel: "chat-agent:start",
  input: ChatAgentStartParamsSchema,
  keyField: "sessionId",
  events: {
    chunk: {
      channel: "chat-agent:response:chunk",
      payload: ChatAgentChunkSchema,
    },
    end: {
      channel: "chat-agent:response:end",
      payload: ChatAgentEndSchema,
    },
    error: {
      channel: "chat-agent:response:error",
      payload: ChatAgentErrorSchema,
    },
  },
});

export const chatAgentClient = createClient(chatAgentContracts);
export const chatAgentStreamClient = createStreamClient(
  chatAgentStreamContract,
);
