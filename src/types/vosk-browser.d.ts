declare module "vosk-browser" {
  export const createModel: (modelUrl: string) => Promise<any>;

  export class Model {
    constructor(modelUrl: string);
    KaldiRecognizer: new (sampleRate?: number) => any;
    ready?: boolean;
    on?: (event: string, handler: (message: any) => void) => void;
    setLogLevel?: (level: number) => void;
    terminate?: () => void;
  }

  const Vosk: {
    createModel: typeof createModel;
    Model: typeof Model;
  };

  export default Vosk;
}
