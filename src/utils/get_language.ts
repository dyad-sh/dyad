// Determine language based on file extension
const getLanguage = (filePath: string) => {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    html: "html",
    css: "css",
    json: "json",
    md: "markdown",
    py: "python",
    java: "java",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    // Blockchain languages
    move: "move", // Sui Move
    sol: "sol", // Solidity (Monaco built-in)
    toml: "toml", // Move.toml files
    // Add more as needed
  };

  return languageMap[extension] || "plaintext";
};
export { getLanguage };
