import { atom } from "jotai";
import {
  SupabaseBranch,
  SupabaseOrganization,
  SupabaseProject,
} from "@/ipc/ipc_types";

// Define atom for storing the list of Supabase organizations
export const supabaseOrganizationsAtom = atom<SupabaseOrganization[]>([]);

// Define atom for storing the currently selected Supabase organization
export const selectedSupabaseOrganizationAtom = atom<string | null>(null);

// Define atom for storing the list of Supabase projects
export const supabaseProjectsAtom = atom<SupabaseProject[]>([]);
export const supabaseBranchesAtom = atom<SupabaseBranch[]>([]);

// Define atom for tracking loading state
export const supabaseLoadingAtom = atom<boolean>(false);

// Define atom for storing any error that occurs during loading
export const supabaseErrorAtom = atom<Error | null>(null);

// Define atom for storing the currently selected Supabase project
export const selectedSupabaseProjectAtom = atom<string | null>(null);
