import { test } from "./helpers/test_helper";

test("mcp - call calculator", async ({ po }) => {
  // Run MCP server
  //   const testMcpServerPath = path.join(
  //     __dirname,
  //     "..",
  //     "testing",
  //     "fake-stdio-mcp-server.mjs",
  //   );
  //   const testMcpServerCommand = `node ${testMcpServerPath}`;

  //   await page.getByRole('link', { name: 'Settings' }).click();
  //   await page.getByRole('button', { name: 'Tools (MCP)' }).click();
  //   await page.getByRole('textbox', { name: 'My MCP Server' }).click();
  //   await page.getByRole('textbox', { name: 'My MCP Server' }).fill('testing');
  //   await page.getByRole('textbox', { name: 'node' }).click();
  //   await page.getByRole('textbox', { name: 'node' }).fill('node');
  //   await page.getByRole('textbox', { name: 'path/to/server.js --flag' }).click();
  //   await page.getByRole('textbox', { name: 'path/to/server.js --flag' }).fill('file/path.js');
  //   await page.getByRole('button', { name: 'Add Server' }).click();

  await po.setUp();
  await po.sendPrompt("call_tool=calculator_add");
  await po.snapshotMessages();
});
