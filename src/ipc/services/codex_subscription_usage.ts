// Compatibility exports for the subscription adapter; all direct inference shares reporting.
export {
  startExternalModelUsage as startSubscriptionUsage,
  finishExternalModelUsage as finishSubscriptionUsage,
  interruptExternalModelUsage as interruptSubscriptionUsage,
  normalizeExternalModelUsage as normalizeSubscriptionUsage,
} from "./external_model_usage";
