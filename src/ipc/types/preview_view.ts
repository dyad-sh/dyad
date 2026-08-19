import { z } from "zod";
import {
  createClient,
  createEventClient,
  createSendClient,
  defineContract,
  defineEvent,
  defineSendContract,
} from "../contracts/core";

/**
 * Bounds of the native preview view, in window-relative DIPs.
 *
 * The renderer measures the placeholder element with getBoundingClientRect()
 * (CSS pixels in the zoomed frame) and multiplies by the current zoom factor
 * before sending, because WebContentsView.setBounds() expects DIPs relative to
 * the window's content area.
 */
export const PreviewViewBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

export type PreviewViewBounds = z.infer<typeof PreviewViewBoundsSchema>;

export const PreviewViewNavigationStateSchema = z.object({
  url: z.string(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  isLoading: z.boolean(),
});

export type PreviewViewNavigationState = z.infer<
  typeof PreviewViewNavigationStateSchema
>;

export const previewViewContracts = {
  show: defineContract({
    channel: "preview-view:show",
    input: z.object({
      url: z.string().url(),
      bounds: PreviewViewBoundsSchema,
    }),
    output: z.void(),
  }),
  hide: defineContract({
    channel: "preview-view:hide",
    input: z.void(),
    output: z.void(),
  }),
  goBack: defineContract({
    channel: "preview-view:go-back",
    input: z.void(),
    output: z.void(),
  }),
  goForward: defineContract({
    channel: "preview-view:go-forward",
    input: z.void(),
    output: z.void(),
  }),
  reload: defineContract({
    channel: "preview-view:reload",
    input: z.void(),
    output: z.void(),
  }),
  getAutomationStatus: defineContract({
    channel: "preview-view:get-automation-status",
    input: z.void(),
    output: z.object({
      /**
       * Whether a test run can drive the preview: the debugging switch was
       * applied at boot and Chromium published its port. False until Dyad is
       * restarted after enabling the experiment.
       */
      cdpReady: z.boolean(),
    }),
  }),
} as const;

/**
 * Bounds updates fire on every animation frame while the user drags a panel
 * divider, so they use a one-way send channel: there is nothing to await and
 * fire-and-forget avoids per-message envelope allocation and dangling promise
 * rejections when the component unmounts mid-drag.
 */
export const previewViewSendContracts = {
  setBounds: defineSendContract({
    channel: "preview-view:set-bounds",
    input: PreviewViewBoundsSchema,
  }),
  setOverlayActive: defineSendContract({
    channel: "preview-view:set-overlay-active",
    input: z.object({ active: z.boolean() }),
  }),
} as const;

export const previewViewEvents = {
  navigationState: defineEvent({
    channel: "preview-view:navigation-state",
    payload: PreviewViewNavigationStateSchema,
  }),
  loadFailed: defineEvent({
    channel: "preview-view:load-failed",
    payload: z.object({
      errorCode: z.number(),
      errorDescription: z.string(),
      url: z.string(),
    }),
  }),
  screenshotUpdated: defineEvent({
    channel: "preview-view:screenshot-updated",
    payload: z.object({ dataUrl: z.string() }),
  }),
} as const;

export const previewViewClient = createClient(previewViewContracts);
export const previewViewSendClient = createSendClient(previewViewSendContracts);
export const previewViewEventClient = createEventClient(previewViewEvents);
