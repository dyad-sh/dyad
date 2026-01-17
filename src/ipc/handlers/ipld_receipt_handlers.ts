/**
 * IPLD Receipt IPC Handlers
 * Creates and manages IPLD-ready inference receipts.
 */

import { ipcMain } from "electron";
import log from "electron-log";

import { ipldReceiptService } from "@/lib/ipld_receipt_service";

import type {
  IpldInferenceReceiptInput,
  IpldReceiptRecord,
} from "@/types/ipld_receipt";

const logger = log.scope("ipld_receipt_handlers");

export function registerIpldReceiptHandlers(): void {
  ipcMain.handle(
    "receipt:create",
    async (_, input: IpldInferenceReceiptInput): Promise<IpldReceiptRecord> => {
      const record = await ipldReceiptService.createReceipt(input);
      logger.info("Created IPLD receipt", { cid: record.cid });
      return record;
    }
  );

  ipcMain.handle("receipt:list", async (): Promise<IpldReceiptRecord[]> => {
    return ipldReceiptService.listReceipts();
  });

  ipcMain.handle(
    "receipt:get",
    async (_, cid: string): Promise<IpldReceiptRecord | null> => {
      return ipldReceiptService.getReceipt(cid);
    }
  );

  ipcMain.handle(
    "receipt:verify",
    async (_, cid: string): Promise<{ valid: boolean; computedCid: string }> => {
      return ipldReceiptService.verifyReceipt(cid);
    }
  );

  logger.info("IPLD receipt handlers registered");
}
