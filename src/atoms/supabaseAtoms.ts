import { atom } from "jotai";
import {
  SupabaseBranch,
  SupabaseAccountInfo,
  SupabaseProjectWithAccount,
} from "@/ipc/ipc_types";

// Define atom for storing the list of connected Supabase accounts
export const supabaseAccountsAtom = atom<SupabaseAccountInfo[]>([]);

// Define atom for storing the list of Supabase projects (with account context)
export const supabaseProjectsAtom = atom<SupabaseProjectWithAccount[]>([]);
export const supabaseBranchesAtom = atom<SupabaseBranch[]>([]);

// Define atom for tracking loading state
export const supabaseLoadingAtom = atom<boolean>(false);

// Define atom for storing any error that occurs during loading
export const supabaseErrorAtom = atom<Error | null>(null);

// Define atom for storing the currently selected Supabase project
export const selectedSupabaseProjectAtom = atom<string | null>(null);

// Define atom for tracking the last log timestamp per project (for incremental log loading)
export const lastLogTimestampAtom = atom<Record<string, number>>({});
