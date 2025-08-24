import { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import log from "electron-log";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const logger = log.scope("qwen-provider");

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`;
const QWEN_OAUTH_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";

const QWEN_DIR = ".qwen";
const QWEN_CREDENTIAL_FILENAME = "oauth_creds.json";

export function isQwenSetup(): boolean {
    const homeDir = os.homedir();
    const qwenDir = path.join(homeDir, QWEN_DIR);
    const keyFile = path.join(qwenDir, QWEN_CREDENTIAL_FILENAME);
    return fs.existsSync(qwenDir) && fs.existsSync(keyFile);
}

interface QwenOAuthCredentials {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expiry_date: number;
  resource_url?: string;
}

interface QwenProviderOptions {
  apiKey?: string;
}

export interface QwenProvider {
  (modelId: string): LanguageModel;
}

export function createQwenProvider(options?: QwenProviderOptions): QwenProvider {
  let credentials: QwenOAuthCredentials | null = null;

  const getQwenCachedCredentialPath = (): string => {
    const homeDir = os.homedir();
    const qwenDir = path.join(homeDir, QWEN_DIR);
    return path.join(qwenDir, QWEN_CREDENTIAL_FILENAME);
  };

  const loadCachedQwenCredentials = async (): Promise<QwenOAuthCredentials> => {
    const keyFile = getQwenCachedCredentialPath();

    if (!fs.existsSync(keyFile)) {
      throw new Error(
        `Qwen OAuth credentials not found at ${keyFile}. Please obtain credentials from ${QWEN_OAUTH_BASE_URL} and save them to this location.`
      );
    }

    const credsStr = await fs.promises.readFile(keyFile, "utf-8");
    return JSON.parse(credsStr);
  };

  const isTokenValid = (creds: QwenOAuthCredentials): boolean => {
    
    return Date.now() + 30000 < creds.expiry_date;
  };

  const refreshAccessToken = async (creds: QwenOAuthCredentials): Promise<QwenOAuthCredentials> => {
    logger.info("Refreshing Qwen access token");

    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: QWEN_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: creds.refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to refresh Qwen token: ${response.status} ${response.statusText}`);
    }

    const tokenData = await response.json();

    const newCredentials: QwenOAuthCredentials = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || creds.refresh_token,
      token_type: tokenData.token_type,
      expiry_date: Date.now() + (tokenData.expires_in * 1000),
      resource_url: tokenData.resource_url,
    };

    // Save updated credentials
    const keyFile = getQwenCachedCredentialPath();
    await fs.promises.writeFile(keyFile, JSON.stringify(newCredentials, null, 2));

    logger.info("Successfully refreshed Qwen access token");
    return newCredentials;
  };

  const ensureAuthenticated = async (): Promise<void> => {
    if (!credentials) {
      credentials = await loadCachedQwenCredentials();
    }

    if (!isTokenValid(credentials)) {
      credentials = await refreshAccessToken(credentials);
    }
  };

  const getBaseUrl = (creds: QwenOAuthCredentials): string => {
    let baseUrl = creds.resource_url || "https://dashscope.aliyuncs.com/compatible-mode/v1";
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      baseUrl = `https://${baseUrl}`;
    }
    return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
  };

  return (modelId: string): LanguageModel => {
    const provider = {
      specificationVersion: "v2",
      provider: "QWEN_CODE",
      modelId,
      defaultObjectGenerationMode: "json",
      doGenerate: async (options: any) => {
        await ensureAuthenticated();

        if (!credentials) {
          throw new Error("Failed to authenticate with Qwen");
        }

        const baseURL = getBaseUrl(credentials);
        const apiKey = credentials.access_token;

        logger.info(`Using Qwen API with base URL: ${baseURL}`);

        const openAIProvider = createOpenAICompatible({
          name: "qwen-code",
          apiKey,
          baseURL,
        });

        const model = openAIProvider(modelId);
        return model.doGenerate(options);
      },
      doStream: async (options: any) => {
        await ensureAuthenticated();

        if (!credentials) {
          throw new Error("Failed to authenticate with Qwen");
        }

        const baseURL = getBaseUrl(credentials);
        const apiKey = credentials.access_token;

        logger.info(`Using Qwen API with base URL: ${baseURL}`);

        const openAIProvider = createOpenAICompatible({
          name: "qwen-code",
          apiKey,
          baseURL,
        });

        const model = openAIProvider(modelId);
        return model.doStream(options);
      },
    };

    return provider;
  };
}
