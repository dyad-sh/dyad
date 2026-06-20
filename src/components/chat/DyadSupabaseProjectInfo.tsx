import React from "react";
import { CustomTagState } from "./stateTypes";
import { DyadDbProjectInfo } from "./DyadDbProjectInfo";

interface DyadSupabaseProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadSupabaseProjectInfo(props: DyadSupabaseProjectInfoProps) {
  return <DyadDbProjectInfo provider="Supabase" {...props} />;
}
