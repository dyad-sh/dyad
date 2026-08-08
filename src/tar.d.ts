// Minimal type surface for the `tar` package (node-tar 6.x ships no types and
// @types/tar isn't installed). Only the bits used by app cloud backup.
declare module "tar" {
  interface CreateOptions {
    gzip?: boolean;
    file?: string;
    cwd?: string;
    portable?: boolean;
    filter?: (path: string, stat: unknown) => boolean;
  }
  interface ExtractOptions {
    file?: string;
    cwd?: string;
  }
  export function create(
    options: CreateOptions,
    fileList: string[],
  ): Promise<void>;
  export function extract(
    options: ExtractOptions,
    fileList?: string[],
  ): Promise<void>;
}
