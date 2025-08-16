export interface Tool {
  name: string;
  description: string;
  execute(args: any): Promise<any>;
}
