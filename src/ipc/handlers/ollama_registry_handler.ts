import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import log from "electron-log";
import { createTypedHandler } from "./base";
import { getOllamaApiUrl } from "./local_model_ollama_handler";
import {
  languageModelContracts,
  languageModelEvents,
  type OllamaPullProgress,
} from "../types/language-model";
import { safeSend } from "../utils/safe_sender";
import {
  createNdjsonParser,
  parseOlaRemoteTable,
} from "../utils/ollama_registry";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("ollama_registry");
const execFileAsync = promisify(execFile);

const OLA_REMOTE_BINARY = "ola-remote";
const SEARCH_TIMEOUT_MS = 60_000;
const PROGRESS_INTERVAL_MS = 200;

/**
 * Resolves the `ola-remote` CLI. PATH comes first; the user-local install
 * directories are a fallback for launches whose PATH was not restored from
 * the login shell.
 */
async function findOlaRemote(): Promise<string> {
  const pathDirs = (process.env.PATH ?? "").split(path.delimiter);
  const candidates = [
    ...pathDirs,
    path.join(os.homedir(), ".local", "bin"),
    path.join(os.homedir(), ".cargo", "bin"),
  ]
    .filter(Boolean)
    .map((dir) => path.join(dir, OLA_REMOTE_BINARY));

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not here; try the next directory.
    }
  }
  throw new DyadError(
    "ola-remote was not found. Install it (cargo build --release in the ola-remote repo) and make sure it is on your PATH or in ~/.local/bin.",
    DyadErrorKind.Precondition,
  );
}

async function searchOllamaRegistry(term: string) {
  const binary = await findOlaRemote();
  try {
    const { stdout } = await execFileAsync(binary, ["-a", term], {
      timeout: SEARCH_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { models: parseOlaRemoteTable(stdout) };
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    logger.warn("ola-remote search failed", error);
    throw new DyadError(
      `Ollama registry search failed${stderr ? `: ${stderr}` : ""}`,
      DyadErrorKind.External,
    );
  }
}

const activePulls = new Map<string, AbortController>();

interface OllamaPullLine {
  status?: string;
  error?: string;
  total?: number;
  completed?: number;
}

async function pullOllamaModel(
  sender: Electron.WebContents,
  pullId: string,
  model: string,
): Promise<void> {
  if (activePulls.has(pullId)) {
    throw new DyadError(
      `Pull ${pullId} is already running`,
      DyadErrorKind.Validation,
    );
  }
  const controller = new AbortController();
  activePulls.set(pullId, controller);
  // A closed window cannot show progress or a cancel button, so stop the
  // download rather than leave tens of gigabytes transferring unattended.
  const abortOnDestroy = () => controller.abort();
  sender.once("destroyed", abortOnDestroy);
  if (sender.isDestroyed()) controller.abort();

  let lastSentAt = 0;
  let lastStatus = "";
  const report = (progress: OllamaPullProgress, force = false) => {
    const now = Date.now();
    if (
      !force &&
      progress.status === lastStatus &&
      now - lastSentAt < PROGRESS_INTERVAL_MS
    ) {
      return;
    }
    lastSentAt = now;
    lastStatus = progress.status;
    safeSend(sender, languageModelEvents.ollamaPullProgress.channel, progress);
  };

  const baseUrl = getOllamaApiUrl();
  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: true }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new DyadError(
        `Could not connect to Ollama. Make sure it's running at ${baseUrl}`,
        DyadErrorKind.Precondition,
      );
    }
    if (!response.ok || !response.body) {
      throw new DyadError(
        `Ollama refused to pull ${model}: ${response.status} ${response.statusText}`,
        DyadErrorKind.External,
      );
    }

    // Ollama reports failures as an `{"error": ...}` line, often after an
    // HTTP 200, so every line has to be checked.
    const handleLine = (raw: unknown) => {
      const line = raw as OllamaPullLine;
      if (line.error) {
        throw new DyadError(
          `Ollama could not pull ${model}: ${line.error}`,
          DyadErrorKind.External,
        );
      }
      if (line.status) {
        report({
          pullId,
          status: line.status,
          completed: line.completed,
          total: line.total,
        });
      }
    };

    const parser = createNdjsonParser();
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.push(value).forEach(handleLine);
      }
      parser.flush().forEach(handleLine);
    } finally {
      // An error line ends the loop early; release the connection.
      await reader.cancel().catch(() => {});
    }

    if (lastStatus !== "success") {
      throw new DyadError(
        `Ollama stopped pulling ${model} before it finished`,
        DyadErrorKind.External,
      );
    }
    report({ pullId, status: "success" }, true);
    logger.info(`Pulled Ollama model ${model}`);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new DyadError(
        `Download of ${model} was cancelled`,
        DyadErrorKind.UserCancelled,
      );
    }
    throw error;
  } finally {
    activePulls.delete(pullId);
    sender.removeListener("destroyed", abortOnDestroy);
  }
}

export function registerOllamaRegistryHandlers() {
  createTypedHandler(
    languageModelContracts.searchOllamaRegistry,
    async (_, { term }) => searchOllamaRegistry(term),
  );

  createTypedHandler(
    languageModelContracts.pullOllamaModel,
    async (event, { pullId, model }) =>
      pullOllamaModel(event.sender, pullId, model),
  );

  createTypedHandler(
    languageModelContracts.cancelOllamaPull,
    async (_, { pullId }) => {
      activePulls.get(pullId)?.abort();
    },
  );
}
