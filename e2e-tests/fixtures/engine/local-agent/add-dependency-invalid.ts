import type { LocalAgentFixture } from "../../../../testing/fake-llm-server/localAgentTypes";

// Requests add_dependency with an invalid npm package name so the REAL tool
// execute path (executeAddDependency) runs and fails fast on name validation
// instead of shelling out to a real network install. This lets a hybrid test
// prove the streamed agent loop got past the consent gate and into execution
// without depending on the network or an installed package manager.
export const fixture: LocalAgentFixture = {
  description: "Add a dependency with an invalid name (consent + fast failure)",
  turns: [
    {
      text: "I'll add a dependency to your project.",
      toolCalls: [
        {
          name: "add_dependency",
          args: {
            packages: ["Not A Valid Package!"],
          },
        },
      ],
    },
    {
      text: "Dependency step finished.",
    },
  ],
};
