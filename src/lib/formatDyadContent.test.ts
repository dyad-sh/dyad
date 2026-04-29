import { describe, expect, it } from "vitest";

import {
  formatDyadContentForEditing,
  formatDyadContentToMarkdown,
} from "./formatDyadContent";

describe("formatDyadContentToMarkdown", () => {
  it("renders dyad tags as readable markdown with fenced code blocks", () => {
    const content = `Let's get started on building a Mood Journal & Tracker.

First, let's install the necessary packages.
<dyad-add-dependency packages="react-hook-form zod"></dyad-add-dependency>

Next, we'll create a new file for the MoodJournal component.
<dyad-write path="src/components/MoodJournal.tsx" description="Creating a new MoodJournal component.">
import React from 'react';

export default function MoodJournal() {
  return <div>Hello</div>;
}
</dyad-write>`;

    expect(formatDyadContentToMarkdown(content)).toBe(`Let's get started on building a Mood Journal & Tracker.

First, let's install the necessary packages.
### Install Dependencies

\`\`\`bash
npm install react-hook-form zod
\`\`\`

Next, we'll create a new file for the MoodJournal component.
### Create or Update \`src/components/MoodJournal.tsx\`

Creating a new MoodJournal component.

\`\`\`typescript
import React from 'react';

export default function MoodJournal() {
  return <div>Hello</div>;
}
\`\`\``);
  });

  it("closes unclosed dyad tags before formatting", () => {
    const content =
      '<dyad-write path="src/App.tsx">export default function App() { return null; }';

    expect(formatDyadContentToMarkdown(content)).toBe(`### Create or Update \`src/App.tsx\`

\`\`\`typescript
export default function App() { return null; }
\`\`\``);
  });

  it("formats dyad code blocks as plain editable code", () => {
    const content = `<dyad-write path="src/App.tsx" description="Update app shell.">
"use client";

export default function App() {
  return null;
}
</dyad-write>`;

    expect(formatDyadContentForEditing(content)).toBe(`Create or Update: src/App.tsx

Update app shell.`);
  });
});
