import { IpcClient } from "../../ipc/ipc_client";
import { Tool } from "./Tool";

export class FileSystemTool implements Tool {
  public name = "fileSystem";
  public description = "A tool to read and write files.";

  private appId: number;

  constructor(appId: number) {
    this.appId = appId;
  }

  async execute(args: {
    operation: "readFile" | "writeFile";
    path: string;
    content?: string;
  }): Promise<any> {
    switch (args.operation) {
      case "readFile":
        return this.readFile(args.path);
      case "writeFile":
        if (args.content === undefined) {
          throw new Error("Content is required for writeFile operation.");
        }
        return this.writeFile(args.path, args.content);
      default:
        throw new Error(`Unknown operation: ${(args as any).operation}`);
    }
  }

  private async readFile(path: string): Promise<string> {
    console.log(`FileSystemTool: Reading file at ${path}`);
    return IpcClient.getInstance().fsReadFile(this.appId, path);
  }

  private async writeFile(path: string, content: string): Promise<void> {
    console.log(`FileSystemTool: Writing to file at ${path}`);
    return IpcClient.getInstance().fsWriteFile(this.appId, path, content);
  }
}
