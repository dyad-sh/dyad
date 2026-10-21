import { execFile } from "node:child_process";
import path from "node:path";
import log from "electron-log";
import type { PagefileSettings } from "../shared/pagefile_telemetry";

const logger = log.scope("windows_pagefile");

// The pagefile configuration lives in this key's PagingFiles value, which is
// also what Win32_PageFileSetting reads. Querying the registry directly
// avoids a PowerShell/WMI start-up, which can take seconds.
const MEMORY_MANAGEMENT_KEY =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management";
const REG_TIMEOUT_MS = 5_000;

/**
 * Classifies the entries of the PagingFiles multi-string. Each entry is
 * `<path>` or `<path> <initialMB> <maxMB>`:
 *   `?:\pagefile.sys`          automatic management of every drive
 *   `C:\pagefile.sys 0 0`      "System managed size" for that one drive
 *   `C:\pagefile.sys 16 4096`  custom size, fixed maximum of 4096 MB
 * An empty list means no pagefile at all.
 *
 * Any entry Windows is free to grow makes the mode "auto", since what the
 * mode answers is whether the commit limit can still rise under pressure.
 */
export function classifyPagingFiles(entries: string[]): PagefileSettings {
  let growable = false;
  let fixedMaxMB = 0;
  let fixedCount = 0;
  for (const entry of entries) {
    const match = entry.trim().match(/^(.+?)(?:\s+(\d+)\s+(\d+))?$/);
    if (!match) {
      continue;
    }
    const maxMB = match[3] === undefined ? 0 : Number(match[3]);
    if (maxMB > 0) {
      fixedCount++;
      fixedMaxMB += maxMB;
    } else {
      growable = true;
    }
  }
  if (growable) {
    return { mode: "auto" };
  }
  if (fixedCount > 0) {
    return { mode: "fixed", maxMB: fixedMaxMB };
  }
  return { mode: "none" };
}

/**
 * Parses `reg query` output for the Memory Management key. reg.exe prints a
 * REG_MULTI_SZ with the entries joined by a literal `\0`:
 *
 *     HKEY_LOCAL_MACHINE\SYSTEM\...\Memory Management
 *         PagingFiles    REG_MULTI_SZ    ?:\pagefile.sys\0D:\pagefile.sys 0 0
 *
 * Returns null when the output does not look like the key at all; a key
 * without the value means no pagefile is configured.
 */
export function parsePagingFilesFromRegOutput(
  output: string,
): PagefileSettings | null {
  let sawKey = false;
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_LOCAL_MACHINE\\/i.test(line.trim())) {
      sawKey = true;
      continue;
    }
    const match = line.match(/^\s*PagingFiles\s+REG_MULTI_SZ\s*(.*?)\s*$/i);
    if (match) {
      return classifyPagingFiles(
        match[1].split("\\0").filter((entry) => entry.trim().length > 0),
      );
    }
  }
  return sawKey ? { mode: "none" } : null;
}

function getSystemRoot(): string {
  return process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
}

function runRegQuery(): Promise<string> {
  const reg = path.join(getSystemRoot(), "System32", "reg.exe");
  return new Promise((resolve, reject) => {
    execFile(
      reg,
      ["query", MEMORY_MANAGEMENT_KEY],
      { timeout: REG_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

let pending: Promise<PagefileSettings | null> | null = null;
let cached: PagefileSettings | null = null;

/**
 * The pagefile configuration, queried once per launch. It rarely changes,
 * and a change only takes effect after a reboot, so the value read at
 * start-up is the one in effect for the whole session.
 *
 * Resolves null off Windows and on any failure.
 */
export function queryWindowsPagefileSettings(): Promise<PagefileSettings | null> {
  if (process.platform !== "win32") {
    return Promise.resolve(null);
  }
  if (!pending) {
    pending = runRegQuery()
      .then((output) => {
        const settings = parsePagingFilesFromRegOutput(output);
        if (!settings) {
          logger.warn("Could not find PagingFiles in registry output");
        } else {
          logger.info("Pagefile settings:", settings);
        }
        return settings;
      })
      .catch((error) => {
        logger.warn("Failed to query pagefile settings:", error);
        return null;
      })
      .then((settings) => {
        cached = settings;
        return settings;
      });
  }
  return pending;
}

/**
 * The query result once it has resolved, for the synchronous heartbeat. Null
 * until then, off Windows, or when the query failed.
 */
export function getCachedPagefileSettings(): PagefileSettings | null {
  return cached;
}
