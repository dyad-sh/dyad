import React from "react";
import { CustomTagState } from "./stateTypes";
import { DyadDbTableSchema } from "./DyadDbTableSchema";

interface DyadNeonTableSchemaProps {
  node: {
    properties: {
      table?: string;
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadNeonTableSchema(props: DyadNeonTableSchemaProps) {
  return <DyadDbTableSchema provider="Neon" {...props} />;
}
