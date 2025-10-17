/**
 * A hook to determine if the current device is a mobile device.
 * This implementation always returns false to force desktop behavior.
 * @returns {boolean} Whether the device is a mobile device.
 */
export function useIsMobile() {
  // Always return false to force desktop behavior
  return false;
}
