// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webFrame } from "electron";
import {
  VALID_INVOKE_CHANNELS,
  VALID_RECEIVE_CHANNELS,
  VALID_SEND_CHANNELS,
  type ValidInvokeChannel,
  type ValidReceiveChannel,
  type ValidSendChannel,
} from "./ipc/preload/channels";
import { isIpcInvokeEnvelope, unwrapIpcEnvelope } from "./ipc/contracts/core";

// Use the contract-derived channel arrays
const validInvokeChannels = VALID_INVOKE_CHANNELS;
const validReceiveChannels = VALID_RECEIVE_CHANNELS;

function isValidReceiveChannel(
  channel: string,
): channel is ValidReceiveChannel {
  return validReceiveChannels.includes(channel as ValidReceiveChannel);
}

function isValidDynamicReceiveChannel(channel: string): boolean {
  // Terminal stream suffixes must stay server-generated, unpredictable session
  // IDs. Do not extend this pattern to renderer-controlled channel names.
  return (
    channel.startsWith("terminal:data:") || channel.startsWith("terminal:exit:")
  );
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: (channel: ValidInvokeChannel | string, ...args: unknown[]) => {
      if ((validInvokeChannels as readonly string[]).includes(channel)) {
        return ipcRenderer.invoke(channel, ...args).then((response) => {
          if (isIpcInvokeEnvelope(response)) {
            return unwrapIpcEnvelope(response);
          }
          return response;
        });
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    invokeEnvelope: (
      channel: ValidInvokeChannel | string,
      ...args: unknown[]
    ) => {
      if ((validInvokeChannels as readonly string[]).includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    // One-way, fire-and-forget renderer -> main. No response is returned, so
    // this is safe to call while the frame is being torn down (e.g. from a
    // `pagehide` handler on app quit), where a reply-expecting `invoke` would
    // make the main process throw "Object has been destroyed".
    send: (channel: ValidSendChannel | string, ...args: unknown[]) => {
      if ((VALID_SEND_CHANNELS as readonly string[]).includes(channel)) {
        ipcRenderer.send(channel, ...args);
        return;
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    on: (
      channel: ValidReceiveChannel | string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (
        isValidReceiveChannel(channel) ||
        isValidDynamicReceiveChannel(channel)
      ) {
        const subscription = (
          _event: Electron.IpcRendererEvent,
          ...args: unknown[]
        ) => listener(...args);
        ipcRenderer.on(channel, subscription);
        return () => {
          ipcRenderer.removeListener(channel, subscription);
        };
      }
      throw new Error(`Invalid channel: ${channel}`);
    },
    removeAllListeners: (channel: ValidReceiveChannel | string) => {
      if (
        isValidReceiveChannel(channel) ||
        isValidDynamicReceiveChannel(channel)
      ) {
        ipcRenderer.removeAllListeners(channel);
      }
    },
    removeListener: (
      channel: ValidReceiveChannel | string,
      listener: (...args: unknown[]) => void,
    ) => {
      if (
        isValidReceiveChannel(channel) ||
        isValidDynamicReceiveChannel(channel)
      ) {
        ipcRenderer.removeListener(channel, listener);
      }
    },
  },
  webFrame: {
    setZoomFactor: (factor: number) => {
      webFrame.setZoomFactor(factor);
    },
    getZoomFactor: () => webFrame.getZoomFactor(),
  },
});
