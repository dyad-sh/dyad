import React from "react";
import { CustomTagState } from "./stateTypes";
import { DyadDbTableSchema } from "./DyadDbTableSchema";

interface DyadSupabaseTableSchemaProps {
  node: {
    properties: {
      table?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadSupabaseTableSchema(props: DyadSupabaseTableSchemaProps) {
  return <DyadDbTableSchema provider="Supabase" {...props} />;
}
