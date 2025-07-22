import log from "electron-log";

const logger = log.scope("file_uploads_state");

export interface FileUploadInfo {
  filePath: string;
  originalName: string;
}

export class FileUploadsState {
  private static instance: FileUploadsState;
  private currentChatId: number | null = null;
  private fileUploadsMap = new Map<string, FileUploadInfo>();

  private constructor() {}

  public static getInstance(): FileUploadsState {
    if (!FileUploadsState.instance) {
      FileUploadsState.instance = new FileUploadsState();
    }
    return FileUploadsState.instance;
  }

  /**
   * Initialize file uploads state for a specific chat and message
   */
  public initialize({ chatId }: { chatId: number }): void {
    this.currentChatId = chatId;
    this.fileUploadsMap.clear();
    logger.debug(`Initialized file uploads state for chat ${chatId}`);
  }

  /**
   * Add a file upload mapping
   */
  public addFileUpload(fileId: string, fileInfo: FileUploadInfo): void {
    this.fileUploadsMap.set(fileId, fileInfo);
    logger.log(`Added file upload: ${fileId} -> ${fileInfo.originalName}`);
  }

  /**
   * Get the current file uploads map
   */
  public getFileUploadsForChat(chatId: number): Map<string, FileUploadInfo> {
    if (this.currentChatId !== chatId) {
      return new Map();
    }
    return new Map(this.fileUploadsMap);
  }

  /**
   * Get current chat ID
   */
  public getCurrentChatId(): number | null {
    return this.currentChatId;
  }

  /**
   * Clear the current state
   */
  public clear(): void {
    this.currentChatId = null;
    this.fileUploadsMap.clear();
    logger.debug("Cleared file uploads state");
  }
}
