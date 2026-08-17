/**
 * Canonical connection taxonomy for Settings.
 *
 * Plugins expand what the assistant can do or retrieve. Integrations connect
 * the assistant to a user's own account, data, or publishing destination.
 * Keeping this distinction as data prevents the Settings UI and search copy
 * from quietly drifting apart.
 */

export type PluginCatalogId =
  | "github"
  | "vercel"
  | "lovable"
  | "canva"
  | "duckduckgo"
  | "coingecko"
  | "weather"
  | "maps"
  | "travel-search"
  | "amadeus"
  | "skyscanner"
  | "duffel";

export type IntegrationCatalogId = "supabase" | "facebook" | "x";

export type ConnectionCatalogEntry<Id extends string> = {
  id: Id;
  title: string;
  description: string;
};

export type PluginCategory = {
  id: "developer" | "creative" | "live-data" | "travel";
  title: string;
  description: string;
  plugins: readonly ConnectionCatalogEntry<PluginCatalogId>[];
};

export const PLUGIN_CATEGORIES: readonly PluginCategory[] = [
  {
    id: "developer",
    title: "Developer & Project Tools",
    description: "Build, inspect and deploy software projects.",
    plugins: [
      {
        id: "github",
        title: "GitHub",
        description: "Repository and file management",
      },
      {
        id: "vercel",
        title: "Vercel",
        description: "Project and deployment management",
      },
      {
        id: "lovable",
        title: "Lovable",
        description: "MCP access to projects, builds and published sites",
      },
    ],
  },
  {
    id: "creative",
    title: "Creative & Design",
    description: "Create and refine visual content with the Chat Agent.",
    plugins: [
      {
        id: "canva",
        title: "Canva",
        description: "Create, edit, search and export Canva designs",
      },
    ],
  },
  {
    id: "live-data",
    title: "Search & Live Data",
    description: "Give the Chat Agent current information from the web.",
    plugins: [
      {
        id: "duckduckgo",
        title: "DuckDuckGo",
        description: "Keyless web search and Instant Answers",
      },
      {
        id: "coingecko",
        title: "CoinGecko",
        description: "Live cryptocurrency prices and market data",
      },
      {
        id: "weather",
        title: "Open-Meteo",
        description: "Keyless live weather and forecasts",
      },
      {
        id: "maps",
        title: "Maps",
        description: "Place search with interactive OpenFreeMap maps",
      },
    ],
  },
  {
    id: "travel",
    title: "Travel & Flights",
    description: "Search current or simulated fares for trip planning.",
    plugins: [
      {
        id: "travel-search",
        title: "Travel Search",
        description: "Keyless flight search with links to current fares",
      },
      {
        id: "amadeus",
        title: "Amadeus Flight Offers",
        description: "Structured flight fares with a free monthly API quota",
      },
      {
        id: "skyscanner",
        title: "Skyscanner",
        description: "Live flight prices for approved API partners",
      },
      {
        id: "duffel",
        title: "Duffel Sandbox",
        description: "Simulated flight fares for development and testing",
      },
    ],
  },
] as const;

export const INTEGRATIONS: readonly ConnectionCatalogEntry<IntegrationCatalogId>[] =
  [
    {
      id: "supabase",
      title: "Supabase",
      description:
        "PostgreSQL databases, authentication and application storage",
    },
    {
      id: "facebook",
      title: "Facebook",
      description: "Publish posts and images to a connected Facebook Page",
    },
    {
      id: "x",
      title: "X",
      description: "Publish posts and images to a connected X account",
    },
  ] as const;
