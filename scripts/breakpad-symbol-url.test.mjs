import assert from "node:assert/strict";
import test from "node:test";
import {
  breakpadSymFileName,
  breakpadSymbolUrl,
} from "./breakpad-symbol-url.mjs";

const SERVER = "https://symbols.electronjs.org";

// Debug identities below are the real ones from Dyad 1.24.0 (Electron
// 40.0.0) release binaries; each URL was checked against the server.

test("Windows PDB debug files drop .pdb from the .sym name", () => {
  assert.equal(
    breakpadSymbolUrl(
      SERVER,
      "electron.exe.pdb",
      "FF24E1F0EB7E01CF4C4C44205044422E1",
    ),
    "https://symbols.electronjs.org/electron.exe.pdb/FF24E1F0EB7E01CF4C4C44205044422E1/electron.exe.sym",
  );
});

test("the .pdb extension is matched case-insensitively", () => {
  assert.equal(breakpadSymFileName("ELECTRON.EXE.PDB"), "ELECTRON.EXE.sym");
  assert.equal(breakpadSymFileName("conpty.pdb"), "conpty.sym");
});

test("macOS debug files keep their name, with spaces encoded", () => {
  assert.equal(
    breakpadSymbolUrl(
      SERVER,
      "Electron Framework",
      "4C4C44D055553144A1FE2A4F63E403B30",
    ),
    "https://symbols.electronjs.org/Electron%20Framework/4C4C44D055553144A1FE2A4F63E403B30/Electron%20Framework.sym",
  );
});

test("Linux debug files keep their name", () => {
  assert.equal(
    breakpadSymbolUrl(SERVER, "electron", "DF23C4907A7C231BEA2D1962BED725290"),
    "https://symbols.electronjs.org/electron/DF23C4907A7C231BEA2D1962BED725290/electron.sym",
  );
});

test("only a trailing .pdb is dropped", () => {
  assert.equal(breakpadSymFileName("libfoo.pdb.so"), "libfoo.pdb.so.sym");
  assert.equal(breakpadSymFileName("pdb"), "pdb.sym");
});
