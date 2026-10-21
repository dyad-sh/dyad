import { describe, it, expect } from "vitest";
import {
  classifyPagingFiles,
  parsePagingFilesFromRegOutput,
} from "@/utils/windows_pagefile";

const KEY_LINE =
  "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management";

function regOutput(values: string[]): string {
  return ["", KEY_LINE, ...values.map((v) => `    ${v}`), ""].join("\r\n");
}

describe("classifyPagingFiles", () => {
  it("reports auto for the automatically managed placeholder", () => {
    expect(classifyPagingFiles(["?:\\pagefile.sys"])).toEqual({
      mode: "auto",
    });
  });

  it("reports auto for a drive set to system managed size", () => {
    expect(classifyPagingFiles(["C:\\pagefile.sys 0 0"])).toEqual({
      mode: "auto",
    });
  });

  it("reports fixed with the summed maximum for custom sizes", () => {
    expect(
      classifyPagingFiles([
        "C:\\pagefile.sys 16 4096",
        "D:\\pagefile.sys 1024 2048",
      ]),
    ).toEqual({ mode: "fixed", maxMB: 6144 });
  });

  it("reports auto when any pagefile can still grow", () => {
    // The question the mode answers is whether the commit limit can rise.
    expect(
      classifyPagingFiles(["C:\\pagefile.sys 16 4096", "D:\\pagefile.sys 0 0"]),
    ).toEqual({ mode: "auto" });
  });

  it("reports none when no pagefile is configured", () => {
    expect(classifyPagingFiles([])).toEqual({ mode: "none" });
  });
});

describe("parsePagingFilesFromRegOutput", () => {
  it("splits reg.exe's literal \\0 multi-string separator", () => {
    expect(
      parsePagingFilesFromRegOutput(
        regOutput([
          "ClearPageFileAtShutdown    REG_DWORD    0x0",
          "PagingFiles    REG_MULTI_SZ    C:\\pagefile.sys 1024 4096\\0D:\\pagefile.sys 512 1024",
        ]),
      ),
    ).toEqual({ mode: "fixed", maxMB: 5120 });
  });

  it("treats an empty value as no pagefile", () => {
    expect(
      parsePagingFilesFromRegOutput(
        regOutput(["PagingFiles    REG_MULTI_SZ    "]),
      ),
    ).toEqual({ mode: "none" });
  });

  it("treats a key without the value as no pagefile", () => {
    expect(
      parsePagingFilesFromRegOutput(
        regOutput(["ClearPageFileAtShutdown    REG_DWORD    0x0"]),
      ),
    ).toEqual({ mode: "none" });
  });

  it("returns null for output that is not the key at all", () => {
    expect(
      parsePagingFilesFromRegOutput("ERROR: Access is denied."),
    ).toBeNull();
    expect(parsePagingFilesFromRegOutput("")).toBeNull();
  });
});
