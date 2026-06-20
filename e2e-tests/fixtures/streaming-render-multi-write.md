Creating five files to verify streaming-renderer block stability.

<dyad-write path="src/streaming/StreamingRenderBlockA.tsx" description="Block A test fixture">
import React from "react";

export const StreamingRenderBlockA = () => {
  return (
    <div data-testid="streaming-render-block-a">
      <h1>Streaming Render Block A</h1>
      <p>This block is the first of five emitted by the multi-write fixture.</p>
      <p>Its purpose is to verify that closed blocks remain visible while later blocks are still streaming.</p>
    </div>
  );
};

export default StreamingRenderBlockA;
</dyad-write>

A short markdown paragraph between the first and second blocks so the parser sees a markdown segment as well as custom-tag segments.

<dyad-write path="src/streaming/StreamingRenderBlockB.tsx" description="Block B test fixture">
import React from "react";

export const StreamingRenderBlockB = () => {
  return (
    <div data-testid="streaming-render-block-b">
      <h1>Streaming Render Block B</h1>
      <p>This block follows block A. By the time it appears, block A should already be closed and rendered.</p>
      <p>The renderer must keep the block A subtree mounted across the chunks that produce block B.</p>
    </div>
  );
};

export default StreamingRenderBlockB;
</dyad-write>

Another markdown segment to exercise interleaved markdown and custom-tag block segments.

<dyad-write path="src/streaming/StreamingRenderBlockC.tsx" description="Block C test fixture">
import React from "react";

export const StreamingRenderBlockC = () => {
  return (
    <div data-testid="streaming-render-block-c">
      <h1>Streaming Render Block C</h1>
      <p>This is the middle block of the fixture and serves as a sanity check that interior blocks render.</p>
    </div>
  );
};

export default StreamingRenderBlockC;
</dyad-write>

<dyad-write path="src/streaming/StreamingRenderBlockD.tsx" description="Block D test fixture">
import React from "react";

export const StreamingRenderBlockD = () => {
  return (
    <div data-testid="streaming-render-block-d">
      <h1>Streaming Render Block D</h1>
      <p>This is the fourth block of the fixture.</p>
    </div>
  );
};

export default StreamingRenderBlockD;
</dyad-write>

<dyad-write path="src/streaming/StreamingRenderBlockE.tsx" description="Block E test fixture">
import React from "react";

export const StreamingRenderBlockE = () => {
  return (
    <div data-testid="streaming-render-block-e">
      <h1>Streaming Render Block E</h1>
      <p>This is the last block of the fixture. By the time it appears, the test asserts blocks A through D are all still mounted.</p>
    </div>
  );
};

export default StreamingRenderBlockE;
</dyad-write>

All five files generated.
