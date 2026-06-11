import { slugifyAppPath } from "@/shared/slugify";

export interface VercelProject {
  id: string;
  name: string;
  framework?: string | null;
}

export interface VercelTokenState {
  accessToken: string;
}

export type VercelTokenAction =
  | { type: "set-token"; token: string }
  | { type: "clear-token" };

export const initialVercelTokenState: VercelTokenState = {
  accessToken: "",
};

export function vercelTokenReducer(
  state: VercelTokenState,
  action: VercelTokenAction,
): VercelTokenState {
  switch (action.type) {
    case "set-token":
      return { ...state, accessToken: action.token };
    case "clear-token":
      return { ...state, accessToken: "" };
  }
}

export type VercelProjectSetupMode = "create" | "existing";

export interface VercelProjectSetupState {
  mode: VercelProjectSetupMode;
  selectedProject: string;
  projectName: string;
  projectAvailable: boolean | null;
  projectCheckError: string | null;
  isCheckingProject: boolean;
}

export type VercelProjectSetupAction =
  | { type: "set-mode"; mode: VercelProjectSetupMode }
  | { type: "select-project"; projectId: string }
  | { type: "set-project-name"; name: string }
  | { type: "project-check-started" }
  | { type: "project-check-skipped" }
  | { type: "project-check-succeeded"; available: boolean; error?: string }
  | { type: "project-check-failed"; error: string };

export function getInitialVercelProjectSetupState(
  folderName: string,
): VercelProjectSetupState {
  return {
    mode: "create",
    selectedProject: "",
    projectName: slugifyAppPath(folderName),
    projectAvailable: null,
    projectCheckError: null,
    isCheckingProject: false,
  };
}

export function vercelProjectSetupReducer(
  state: VercelProjectSetupState,
  action: VercelProjectSetupAction,
): VercelProjectSetupState {
  switch (action.type) {
    case "set-mode":
      return {
        ...state,
        mode: action.mode,
      };
    case "select-project":
      return { ...state, selectedProject: action.projectId };
    case "set-project-name":
      return {
        ...state,
        projectName: action.name,
        projectAvailable: null,
        projectCheckError: null,
      };
    case "project-check-started":
      return {
        ...state,
        projectAvailable: null,
        projectCheckError: null,
        isCheckingProject: true,
      };
    case "project-check-skipped":
      return {
        ...state,
        projectAvailable: null,
        projectCheckError: null,
        isCheckingProject: false,
      };
    case "project-check-succeeded":
      return {
        ...state,
        projectAvailable: action.available,
        projectCheckError: action.available
          ? null
          : action.error || "Project name is not available.",
        isCheckingProject: false,
      };
    case "project-check-failed":
      return {
        ...state,
        projectCheckError: action.error,
        isCheckingProject: false,
      };
  }
}
