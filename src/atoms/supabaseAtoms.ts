import { atom } from "jotai";

// Define atom for storing the list of Supabase projects
export const supabaseProjectsAtom = atom<any[]>([]);

// Define atom for tracking loading state
export const supabaseLoadingAtom = atom<boolean>(false);

// Define atom for storing any error that occurs during loading
export const supabaseErrorAtom = atom<Error | null>(null);

// Define atom for storing the currently selected Supabase project
export const selectedSupabaseProjectAtom = atom<string | null>(null);
