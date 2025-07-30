import { describe, it, expect } from "vitest";
import { createProblemFixPrompt } from "../shared/problem_prompt";
import type { ProblemReport } from "../ipc/ipc_types";

const snippet = `SNIPPET`;

describe("problem_prompt", () => {
  describe("createProblemFixPrompt", () => {
    it("should return a message when no problems exist", () => {
      const problemReport: ProblemReport = {
        problems: [],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });

    it("should format a single error correctly", () => {
      const problemReport: ProblemReport = {
        problems: [
          {
            file: "src/components/Button.tsx",
            line: 15,
            column: 23,
            message: "Property 'onClick' does not exist on type 'ButtonProps'.",
            code: 2339,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });

    it("should format multiple errors across multiple files", () => {
      const problemReport: ProblemReport = {
        problems: [
          {
            file: "src/components/Button.tsx",
            line: 15,
            column: 23,
            message: "Property 'onClick' does not exist on type 'ButtonProps'.",
            code: 2339,
            snippet,
          },
          {
            file: "src/components/Button.tsx",
            line: 8,
            column: 12,
            message:
              "Type 'string | undefined' is not assignable to type 'string'.",
            code: 2322,
            snippet,
          },
          {
            file: "src/hooks/useApi.ts",
            line: 42,
            column: 5,
            message:
              "Argument of type 'unknown' is not assignable to parameter of type 'string'.",
            code: 2345,
            snippet,
          },
          {
            file: "src/utils/helpers.ts",
            line: 45,
            column: 8,
            message:
              "Function lacks ending return statement and return type does not include 'undefined'.",
            code: 2366,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });

    it("should handle realistic React TypeScript errors", () => {
      const problemReport: ProblemReport = {
        problems: [
          {
            file: "src/components/UserProfile.tsx",
            line: 12,
            column: 35,
            message:
              "Type '{ children: string; }' is missing the following properties from type 'UserProfileProps': user, onEdit",
            code: 2739,
            snippet,
          },
          {
            file: "src/components/UserProfile.tsx",
            line: 25,
            column: 15,
            message: "Object is possibly 'null'.",
            code: 2531,
            snippet,
          },
          {
            file: "src/hooks/useLocalStorage.ts",
            line: 18,
            column: 12,
            message: "Type 'string | null' is not assignable to type 'T'.",
            code: 2322,
            snippet,
          },
          {
            file: "src/types/api.ts",
            line: 45,
            column: 3,
            message: "Duplicate identifier 'UserRole'.",
            code: 2300,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });
  });

  describe("createConciseProblemFixPrompt", () => {
    it("should return a short message when no problems exist", () => {
      const problemReport: ProblemReport = {
        problems: [],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });

    it("should format a concise prompt for single error", () => {
      const problemReport: ProblemReport = {
        problems: [
          {
            file: "src/App.tsx",
            line: 10,
            column: 5,
            message: "Cannot find name 'consol'. Did you mean 'console'?",
            code: 2552,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });

    it("should format a concise prompt for multiple errors", () => {
      const problemReport: ProblemReport = {
        problems: [
          {
            file: "src/main.ts",
            line: 5,
            column: 12,
            message:
              "Cannot find module 'react-dom/client' or its corresponding type declarations.",
            code: 2307,
            snippet,
          },
          {
            file: "src/components/Modal.tsx",
            line: 35,
            column: 20,
            message:
              "Property 'isOpen' does not exist on type 'IntrinsicAttributes & ModalProps'.",
            code: 2339,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });
  });

  describe("realistic TypeScript error scenarios", () => {
    it("should handle common React + TypeScript errors", () => {
      const problemReport: ProblemReport = {
        problems: [
          // Missing interface property
          {
            file: "src/components/ProductCard.tsx",
            line: 22,
            column: 18,
            message:
              "Property 'price' is missing in type '{ name: string; description: string; }' but required in type 'Product'.",
            code: 2741,
            snippet,
          },
          // Incorrect event handler type
          {
            file: "src/components/SearchInput.tsx",
            line: 15,
            column: 45,
            message:
              "Type '(value: string) => void' is not assignable to type 'ChangeEventHandler<HTMLInputElement>'.",
            code: 2322,
            snippet,
          },
          // Async/await without Promise return type
          {
            file: "src/api/userService.ts",
            line: 8,
            column: 1,
            message:
              "Function lacks ending return statement and return type does not include 'undefined'.",
            code: 2366,
            snippet,
          },
          // Strict null check
          {
            file: "src/utils/dataProcessor.ts",
            line: 34,
            column: 25,
            message: "Object is possibly 'undefined'.",
            code: 2532,
            snippet,
          },
        ],
      };

      const result = createProblemFixPrompt(problemReport);
      expect(result).toMatchSnapshot();
    });
  });
});
