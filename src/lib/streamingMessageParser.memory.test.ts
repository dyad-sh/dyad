import v8 from "node:v8";
import vm from "node:vm";
import { expect, it } from "vitest";
import {
  advanceParser,
  initialParserState,
  type ParserState,
} from "@/lib/streamingMessageParser";

v8.setFlagsFromString("--expose-gc");
const gc = vm.runInNewContext("gc") as () => void;

function heapUsed(): number {
  gc();
  gc();
  return v8.getHeapStatistics().used_heap_size;
}

it("closed blocks do not retain earlier versions of the streamed message", () => {
  const blockCount = 40;
  const payload = "a".repeat(100_000);
  const before = heapUsed();

  let state: ParserState | null = initialParserState();
  let content = "Intro text. ";
  for (let i = 0; i < blockCount; i++) {
    content += `<dyad-mcp-tool-call server="s" tool="t" call-id="c${i}">\n${payload}\n</dyad-mcp-tool-call>\n`;
    state = advanceParser(state, content);
  }
  const messageBytes = content.length;
  content = "";
  const retained = heapUsed() - before;

  expect(state.blocks.length).toBeGreaterThanOrEqual(blockCount);
  // The blocks hold one copy of the 4 MB message. Pinning each version
  // as it was when its block closed would hold about 20 times that.
  expect(retained).toBeLessThan(messageBytes * 3);
  state = null;
});
