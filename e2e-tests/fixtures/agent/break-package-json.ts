import type { LocalAgentFixture } from "../../../testing/fake-llm-server/localAgentTypes";

export const fixture: LocalAgentFixture = {
  description: "Remove the dev script from package.json",
  turns: [
    {
      text: "I will remove the dev script from package.json.",
      toolCalls: [
        {
          name: "write_file",
          args: {
            path: "package.json",
            content: `${JSON.stringify(
              {
                name: "vite_react_shadcn_ts",
                private: true,
                version: "0.0.0",
                type: "module",
                scripts: {
                  build: "vite build",
                  "build:dev": "vite build --mode development",
                  lint: "eslint .",
                  preview: "vite preview",
                },
                dependencies: {
                  react: "^18.3.1",
                  "react-dom": "^18.3.1",
                },
                devDependencies: {
                  "@types/node": "^22.5.5",
                  "@types/react": "^18.3.3",
                  "@types/react-dom": "^18.3.0",
                  "@vitejs/plugin-react-swc": "^4.3.0",
                  typescript: "^5.5.3",
                  vite: "^7.3.2",
                },
              },
              null,
              2,
            )}\n`,
            description: "Remove the dev script",
          },
        },
      ],
    },
    { text: "The dev script was removed." },
  ],
};
