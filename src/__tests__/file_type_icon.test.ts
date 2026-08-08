import { describe, expect, it } from "vitest";

import {
  describeFileType,
  fileBadgeLabel,
  fileExtension,
  fileKindFor,
  formatFileSize,
} from "@/lib/file_type_icon";

describe("fileKindFor", () => {
  it("identifies common kinds by extension", () => {
    expect(fileKindFor("scan.pdf")).toBe("pdf");
    expect(fileKindFor("photo.HEIC")).toBe("image");
    expect(fileKindFor("budget.xlsx")).toBe("spreadsheet");
    expect(fileKindFor("deck.pptx")).toBe("presentation");
    expect(fileKindFor("notes.docx")).toBe("document");
    expect(fileKindFor("main.rs")).toBe("code");
    expect(fileKindFor("config.yaml")).toBe("data");
    expect(fileKindFor("backup.tar.gz")).toBe("archive");
    expect(fileKindFor("voice.m4a")).toBe("audio");
    expect(fileKindFor("clip.mov")).toBe("video");
  });

  it("prefers the extension over a vague MIME type", () => {
    // Browsers report octet-stream for plenty of files the name identifies.
    expect(fileKindFor("report.pdf", "application/octet-stream")).toBe("pdf");
  });

  it("falls back to the MIME type when there is no extension", () => {
    expect(fileKindFor("scan", "application/pdf")).toBe("pdf");
    expect(fileKindFor("clipboard", "image/png")).toBe("image");
  });

  it("uses the MIME prefix for unknown subtypes", () => {
    expect(fileKindFor("take", "audio/x-something")).toBe("audio");
    expect(fileKindFor("render", "video/x-matroska")).toBe("video");
  });

  it("treats a CSV as a spreadsheet, not plain text", () => {
    expect(fileKindFor("rows.csv", "text/csv")).toBe("spreadsheet");
  });

  it("defaults to text for anything unrecognised", () => {
    expect(fileKindFor("mystery")).toBe("text");
    expect(fileKindFor("thing.zzz", "application/x-unknown")).toBe("text");
  });

  it("is case insensitive", () => {
    expect(fileKindFor("SCAN.PDF")).toBe("pdf");
    expect(fileKindFor("x.pdf", "APPLICATION/PDF")).toBe("pdf");
  });
});

describe("describeFileType", () => {
  it("gives every kind an icon, label and accent", () => {
    for (const name of ["a.pdf", "a.png", "a.xlsx", "a.zip", "a.mp3"]) {
      const descriptor = describeFileType(name);
      expect(descriptor.icon).toBeTruthy();
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.className).toContain("text-");
    }
  });

  it("distinguishes a PDF from a spreadsheet", () => {
    const pdf = describeFileType("a.pdf");
    const sheet = describeFileType("a.xlsx");
    expect(pdf.icon).not.toBe(sheet.icon);
    expect(pdf.className).not.toBe(sheet.className);
  });
});

describe("fileExtension and fileBadgeLabel", () => {
  it("reads the extension", () => {
    expect(fileExtension("a.tar.gz")).toBe("gz");
    expect(fileExtension("noext")).toBe("");
  });

  it("shows a short extension as an uppercase badge", () => {
    expect(fileBadgeLabel("report.pdf")).toBe("PDF");
    expect(fileBadgeLabel("sheet.xlsx")).toBe("XLSX");
  });

  it("omits a badge when there is nothing useful to show", () => {
    expect(fileBadgeLabel("noext")).toBe("");
    // Long enough to crowd the tile and read worse than the icon alone.
    expect(fileBadgeLabel("thing.markdown")).toBe("");
  });
});

describe("formatFileSize", () => {
  it("scales the unit", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns nothing for a nonsense size", () => {
    expect(formatFileSize(Number.NaN)).toBe("");
    expect(formatFileSize(-1)).toBe("");
  });
});
