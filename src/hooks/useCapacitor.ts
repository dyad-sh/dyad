/**
 * Capacitor React Hooks
 * Cross-platform hooks for iOS, Android, and Web
 */

import { useState, useEffect, useCallback } from 'react';
import {
  CapacitorPlatform,
  getPlatformInfo,
  type PlatformInfo,
} from '../lib/capacitor-platform';
import type { AppState } from '@capacitor/app';
import type { DeviceInfo, BatteryInfo } from '@capacitor/device';
import type { ConnectionStatus } from '@capacitor/network';
import type { KeyboardInfo } from '@capacitor/keyboard';

// ============================================================================
// Platform Hooks
// ============================================================================

/**
 * Get current platform information
 */
export function usePlatform(): PlatformInfo {
  const [platform] = useState(() => getPlatformInfo());
  return platform;
}

/**
 * Check if running on native platform
 */
export function useIsNative(): boolean {
  const platform = usePlatform();
  return platform.isNative;
}

// ============================================================================
// App Lifecycle Hooks
// ============================================================================

/**
 * Track app state (foreground/background)
 */
export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  
  useEffect(() => {
    // Get initial state
    CapacitorPlatform.App.getState().then(setState);
    
    // Listen for changes
    const unsubscribe = CapacitorPlatform.App.onAppStateChange(setState);
    return unsubscribe;
  }, []);
  
  return state;
}

/**
 * Handle app URL open (deep links)
 */
export function useAppUrlOpen(callback: (url: string) => void): void {
  useEffect(() => {
    const unsubscribe = CapacitorPlatform.App.onAppUrlOpen(({ url }) => {
      callback(url);
    });
    return unsubscribe;
  }, [callback]);
}

/**
 * Handle back button press (Android)
 */
export function useBackButton(callback: () => void): void {
  useEffect(() => {
    const unsubscribe = CapacitorPlatform.App.onBackButton(callback);
    return unsubscribe;
  }, [callback]);
}

// ============================================================================
// Device Hooks
// ============================================================================

/**
 * Get device information
 */
export function useDeviceInfo(): {
  info: DeviceInfo | null;
  isLoading: boolean;
  error: Error | null;
} {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    CapacitorPlatform.Device.getInfo()
      .then(setInfo)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);
  
  return { info, isLoading, error };
}

/**
 * Get battery information
 */
export function useBatteryInfo(): {
  battery: BatteryInfo | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  const fetch = useCallback(() => {
    setIsLoading(true);
    CapacitorPlatform.Device.getBatteryInfo()
      .then(setBattery)
      .catch(setError)
      .finally(() => setIsLoading(false));
  }, []);
  
  useEffect(() => {
    fetch();
  }, [fetch]);
  
  return { battery, isLoading, error, refetch: fetch };
}

// ============================================================================
// Network Hooks
// ============================================================================

/**
 * Track network connection status
 */
export function useNetworkStatus(): {
  status: ConnectionStatus | null;
  isOnline: boolean;
  isLoading: boolean;
} {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Get initial status
    CapacitorPlatform.Network.getStatus()
      .then(setStatus)
      .finally(() => setIsLoading(false));
    
    // Listen for changes
    const unsubscribe = CapacitorPlatform.Network.onNetworkStatusChange(setStatus);
    return unsubscribe;
  }, []);
  
  return {
    status,
    isOnline: status?.connected ?? true,
    isLoading,
  };
}

/**
 * Simple online/offline check
 */
export function useIsOnline(): boolean {
  const { isOnline } = useNetworkStatus();
  return isOnline;
}

// ============================================================================
// Keyboard Hooks
// ============================================================================

/**
 * Track keyboard visibility and height
 */
export function useKeyboard(): {
  isVisible: boolean;
  height: number;
  show: () => Promise<void>;
  hide: () => Promise<void>;
} {
  const [isVisible, setIsVisible] = useState(false);
  const [height, setHeight] = useState(0);
  const platform = usePlatform();
  
  useEffect(() => {
    if (!platform.isNative) return;
    
    const unsubscribeShow = CapacitorPlatform.Keyboard.onKeyboardDidShow((info: KeyboardInfo) => {
      setIsVisible(true);
      setHeight(info.keyboardHeight);
    });
    
    const unsubscribeHide = CapacitorPlatform.Keyboard.onKeyboardDidHide(() => {
      setIsVisible(false);
      setHeight(0);
    });
    
    return () => {
      unsubscribeShow();
      unsubscribeHide();
    };
  }, [platform.isNative]);
  
  const show = useCallback(async () => {
    if (platform.isNative) {
      await CapacitorPlatform.Keyboard.show();
    }
  }, [platform.isNative]);
  
  const hide = useCallback(async () => {
    if (platform.isNative) {
      await CapacitorPlatform.Keyboard.hide();
    }
  }, [platform.isNative]);
  
  return { isVisible, height, show, hide };
}

// ============================================================================
// Haptics Hooks
// ============================================================================

/**
 * Haptic feedback utilities
 */
export function useHaptics(): {
  impact: (style?: 'heavy' | 'medium' | 'light') => Promise<void>;
  notification: (type?: 'success' | 'warning' | 'error') => Promise<void>;
  vibrate: (duration?: number) => Promise<void>;
  selectionChanged: () => Promise<void>;
} {
  const platform = usePlatform();
  
  const impact = useCallback(async (style: 'heavy' | 'medium' | 'light' = 'medium') => {
    if (platform.isNative) {
      await CapacitorPlatform.Haptics.impact(style);
    }
  }, [platform.isNative]);
  
  const notification = useCallback(async (type: 'success' | 'warning' | 'error' = 'success') => {
    if (platform.isNative) {
      await CapacitorPlatform.Haptics.notification(type);
    }
  }, [platform.isNative]);
  
  const vibrate = useCallback(async (duration: number = 300) => {
    if (platform.isNative) {
      await CapacitorPlatform.Haptics.vibrate(duration);
    }
  }, [platform.isNative]);
  
  const selectionChanged = useCallback(async () => {
    if (platform.isNative) {
      await CapacitorPlatform.Haptics.selectionChanged();
    }
  }, [platform.isNative]);
  
  return { impact, notification, vibrate, selectionChanged };
}

// ============================================================================
// Clipboard Hooks
// ============================================================================

/**
 * Clipboard utilities
 */
export function useClipboard(): {
  copy: (text: string) => Promise<void>;
  paste: () => Promise<string | null>;
} {
  const copy = useCallback(async (text: string) => {
    await CapacitorPlatform.Clipboard.write({ string: text });
  }, []);
  
  const paste = useCallback(async () => {
    try {
      const result = await CapacitorPlatform.Clipboard.read();
      return result.value;
    } catch {
      return null;
    }
  }, []);
  
  return { copy, paste };
}

// ============================================================================
// Share Hooks
// ============================================================================

/**
 * Share functionality
 */
export function useShare(): {
  share: (options: { title?: string; text?: string; url?: string; files?: string[] }) => Promise<boolean>;
  canShare: boolean;
} {
  const [canShare, setCanShare] = useState(true);
  
  useEffect(() => {
    CapacitorPlatform.Share.canShare().then(setCanShare);
  }, []);
  
  const share = useCallback(async (options: {
    title?: string;
    text?: string;
    url?: string;
    files?: string[];
  }) => {
    try {
      await CapacitorPlatform.Share.share(options);
      return true;
    } catch {
      return false;
    }
  }, []);
  
  return { share, canShare };
}

// ============================================================================
// Browser Hooks
// ============================================================================

/**
 * In-app browser
 */
export function useBrowser(): {
  open: (url: string, options?: { windowName?: string; toolbarColor?: string }) => Promise<void>;
  close: () => Promise<void>;
} {
  const open = useCallback(async (
    url: string,
    options?: { windowName?: string; toolbarColor?: string }
  ) => {
    await CapacitorPlatform.Browser.open({
      url,
      windowName: options?.windowName,
      toolbarColor: options?.toolbarColor,
    });
  }, []);
  
  const close = useCallback(async () => {
    await CapacitorPlatform.Browser.close();
  }, []);
  
  return { open, close };
}

// ============================================================================
// Preferences (Storage) Hooks
// ============================================================================

/**
 * Persistent storage with reactive updates
 */
export function usePreference<T>(
  key: string,
  defaultValue: T
): [T, (value: T) => Promise<void>, boolean] {
  const [value, setValue] = useState<T>(defaultValue);
  const [isLoading, setIsLoading] = useState(true);
  
  // Load initial value
  useEffect(() => {
    CapacitorPlatform.Preferences.getJSON<T>(key)
      .then((stored) => {
        if (stored !== null) {
          setValue(stored);
        }
      })
      .finally(() => setIsLoading(false));
  }, [key]);
  
  // Save function
  const save = useCallback(async (newValue: T) => {
    await CapacitorPlatform.Preferences.setJSON(key, newValue);
    setValue(newValue);
  }, [key]);
  
  return [value, save, isLoading];
}

// ============================================================================
// Local Notifications Hooks
// ============================================================================

/**
 * Local notifications management
 */
export function useLocalNotifications(): {
  schedule: (notification: {
    id: number;
    title: string;
    body: string;
    schedule?: { at?: Date; repeats?: boolean };
  }) => Promise<void>;
  cancel: (ids: number[]) => Promise<void>;
  requestPermission: () => Promise<boolean>;
  hasPermission: boolean;
} {
  const [hasPermission, setHasPermission] = useState(false);
  
  useEffect(() => {
    CapacitorPlatform.LocalNotifications.checkPermissions()
      .then(({ display }) => setHasPermission(display === 'granted'));
  }, []);
  
  const schedule = useCallback(async (notification: {
    id: number;
    title: string;
    body: string;
    schedule?: { at?: Date; repeats?: boolean };
  }) => {
    await CapacitorPlatform.LocalNotifications.schedule([notification]);
  }, []);
  
  const cancel = useCallback(async (ids: number[]) => {
    await CapacitorPlatform.LocalNotifications.cancel(ids.map(id => ({ id })));
  }, []);
  
  const requestPermission = useCallback(async () => {
    const { display } = await CapacitorPlatform.LocalNotifications.requestPermissions();
    const granted = display === 'granted';
    setHasPermission(granted);
    return granted;
  }, []);
  
  return { schedule, cancel, requestPermission, hasPermission };
}

// ============================================================================
// Push Notifications Hooks
// ============================================================================

/**
 * Push notifications with token
 */
export function usePushNotifications(
  onNotification?: (notification: any) => void
): {
  token: string | null;
  register: () => Promise<void>;
  hasPermission: boolean;
} {
  const [token, setToken] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const platform = usePlatform();
  
  useEffect(() => {
    if (!platform.isNative) return;
    
    CapacitorPlatform.PushNotifications.checkPermissions()
      .then(({ receive }) => setHasPermission(receive === 'granted'));
    
    const unsubscribeToken = CapacitorPlatform.PushNotifications.onRegistration((t) => {
      setToken(t.value);
    });
    
    const unsubscribeNotification = onNotification
      ? CapacitorPlatform.PushNotifications.onPushNotificationReceived(onNotification)
      : undefined;
    
    return () => {
      unsubscribeToken();
      unsubscribeNotification?.();
    };
  }, [platform.isNative, onNotification]);
  
  const register = useCallback(async () => {
    if (!platform.isNative) return;
    
    const { receive } = await CapacitorPlatform.PushNotifications.requestPermissions();
    setHasPermission(receive === 'granted');
    
    if (receive === 'granted') {
      await CapacitorPlatform.PushNotifications.register();
    }
  }, [platform.isNative]);
  
  return { token, register, hasPermission };
}

// ============================================================================
// Splash Screen Hooks
// ============================================================================

/**
 * Control splash screen
 */
export function useSplashScreen(): {
  hide: () => Promise<void>;
  show: () => Promise<void>;
} {
  const hide = useCallback(async () => {
    await CapacitorPlatform.SplashScreen.hide();
  }, []);
  
  const show = useCallback(async () => {
    await CapacitorPlatform.SplashScreen.show();
  }, []);
  
  return { hide, show };
}

// ============================================================================
// Status Bar Hooks
// ============================================================================

/**
 * Control status bar appearance
 */
export function useStatusBar(): {
  setStyle: (style: 'dark' | 'light' | 'default') => Promise<void>;
  setBackgroundColor: (color: string) => Promise<void>;
  show: () => Promise<void>;
  hide: () => Promise<void>;
} {
  const platform = usePlatform();
  
  const setStyle = useCallback(async (style: 'dark' | 'light' | 'default') => {
    if (platform.isNative) {
      await CapacitorPlatform.StatusBar.setStyle(style);
    }
  }, [platform.isNative]);
  
  const setBackgroundColor = useCallback(async (color: string) => {
    if (platform.isNative) {
      await CapacitorPlatform.StatusBar.setBackgroundColor(color);
    }
  }, [platform.isNative]);
  
  const show = useCallback(async () => {
    if (platform.isNative) {
      await CapacitorPlatform.StatusBar.show();
    }
  }, [platform.isNative]);
  
  const hide = useCallback(async () => {
    if (platform.isNative) {
      await CapacitorPlatform.StatusBar.hide();
    }
  }, [platform.isNative]);
  
  return { setStyle, setBackgroundColor, show, hide };
}

// ============================================================================
// File System Hooks
// ============================================================================

/**
 * File system operations
 */
export function useFileSystem(): {
  writeFile: (path: string, data: string) => Promise<string>;
  readFile: (path: string) => Promise<string>;
  deleteFile: (path: string) => Promise<void>;
  exists: (path: string) => Promise<boolean>;
  listDir: (path: string) => Promise<Array<{ name: string; type: string }>>;
} {
  const writeFile = useCallback(async (path: string, data: string) => {
    const result = await CapacitorPlatform.File.writeFile({ path, data });
    return result.uri;
  }, []);
  
  const readFile = useCallback(async (path: string) => {
    const result = await CapacitorPlatform.File.readFile({ path });
    return result.data as string;
  }, []);
  
  const deleteFile = useCallback(async (path: string) => {
    await CapacitorPlatform.File.deleteFile({ path });
  }, []);
  
  const exists = useCallback(async (path: string) => {
    return CapacitorPlatform.File.exists({ path });
  }, []);
  
  const listDir = useCallback(async (path: string) => {
    const result = await CapacitorPlatform.File.readdir({ path });
    return result.files.map(f => ({ name: f.name, type: f.type }));
  }, []);
  
  return { writeFile, readFile, deleteFile, exists, listDir };
}
