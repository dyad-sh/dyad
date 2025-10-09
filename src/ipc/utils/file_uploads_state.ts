import log from "electron-log";

const logger = log.scope("file_uploads_state");

export interface FileUploadInfo {
  filePath: string;
  originalName: string;
}

export class FileUploadsState {
  private static instance: FileUploadsState;
  // Map of chatId -> (fileId -> fileInfo)
  private uploadsByChat = new Map<number, Map<string, FileUploadInfo>>();

  private constructor() {}

  public static getInstance(): FileUploadsState {
    if (!FileUploadsState.instance) {
      FileUploadsState.instance = new FileUploadsState();
    }
    return FileUploadsState.instance;
  }

  /**
   * Ensure a map exists for a chatId
   */
  private ensureChat(chatId: number): Map<string, FileUploadInfo> {
    let map = this.uploadsByChat.get(chatId);
    if (!map) {
      map = new Map<string, FileUploadInfo>();
      this.uploadsByChat.set(chatId, map);
    }
    return map;
  }

  /**
   * Add a file upload mapping to a specific chat
   */
  public addFileUpload(
    { chatId, fileId }: { chatId: number; fileId: string },
    fileInfo: FileUploadInfo,
  ): void {
    const map = this.ensureChat(chatId);
    map.set(fileId, fileInfo);
    logger.log(
      `Added file upload for chat ${chatId}: ${fileId} -> ${fileInfo.originalName}`,
    );
  }

  /**
   * Get a copy of the file uploads map for a specific chat
   */
  public getFileUploadsForChat(chatId: number): Map<string, FileUploadInfo> {
    const map = this.uploadsByChat.get(chatId);
    return new Map(map ?? []);
  }

  // Removed getCurrentChatId(): no longer applicable in per-chat state

  /**
   * Clear state for a specific chat
   */
  public clear(chatId: number): void {
    this.uploadsByChat.delete(chatId);
    logger.debug(`Cleared file uploads state for chat ${chatId}`);
  }

  /**
   * Clear all uploads (primarily for tests or full reset)
   */
  public clearAll(): void {
    this.uploadsByChat.clear();
    logger.debug("Cleared all file uploads state");
  }
}
