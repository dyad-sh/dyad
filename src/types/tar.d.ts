declare module "tar" {
  export interface CreateOptions {
    gzip?: boolean;
    file?: string;
    cwd?: string;
    portable?: boolean;
    noMtime?: boolean;
    filter?: (path: string, stat: any) => boolean;
  }

  export interface ExtractOptions {
    file?: string;
    cwd?: string;
    strip?: number;
    filter?: (path: string, entry: any) => boolean;
  }

  export function create(options: CreateOptions, fileList: string[]): Promise<void>;
  export function c(options: CreateOptions, fileList: string[]): Promise<void>;
  
  export function extract(options: ExtractOptions): Promise<void>;
  export function x(options: ExtractOptions): Promise<void>;
  
  export function list(options: { file?: string }): Promise<void>;
  export function t(options: { file?: string }): Promise<void>;
}
