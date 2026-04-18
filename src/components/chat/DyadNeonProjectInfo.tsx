import React from "react";
import { CustomTagState } from "./stateTypes";
import { DyadDbProjectInfo } from "./DyadDbProjectInfo";

interface DyadNeonProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadNeonProjectInfo(props: DyadNeonProjectInfoProps) {
  return <DyadDbProjectInfo provider="Neon" {...props} />;
}
