import type { AppOutput } from "./misc";

export interface AppRuntimeOutput {
  send(output: AppOutput): void;
  enqueue(output: AppOutput): void;
  flush(): void;
}
