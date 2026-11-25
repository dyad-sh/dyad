// Where a Breakpad symbol server keeps a module's .sym file.
//
// Symbol stores are laid out as <debugFile>/<debugId>/<symFile>. On macOS
// and Linux the .sym file is named after the debug file ("Electron
// Framework" -> "Electron Framework.sym"). On Windows the debug file is a
// PDB, and the .sym file drops the .pdb extension ("electron.exe.pdb" ->
// "electron.exe.sym"), matching the breakpad_symbols/ tree in Electron's
// published symbol zips and what dump_syms writes.

export function breakpadSymFileName(debugFile) {
  const base = debugFile.toLowerCase().endsWith(".pdb")
    ? debugFile.slice(0, -".pdb".length)
    : debugFile;
  return `${base}.sym`;
}

export function breakpadSymbolUrl(serverUrl, debugFile, debugId) {
  return [
    serverUrl,
    encodeURIComponent(debugFile),
    encodeURIComponent(debugId),
    encodeURIComponent(breakpadSymFileName(debugFile)),
  ].join("/");
}
