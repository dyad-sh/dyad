/**
 * Capacitor Platform Service
 * Unified cross-platform API for iOS, Android, and Web
 */

import { Capacitor } from '@capacitor/core';
import { App, type AppInfo, type AppState } from '@capacitor/app';
import { Device, type DeviceInfo, type BatteryInfo } from '@capacitor/device';
import { Filesystem, Directory, Encoding, type WriteFileResult, type ReadFileResult } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { Network, type ConnectionStatus } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style as StatusBarStyle } from '@capacitor/status-bar';
import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Share, type ShareResult } from '@capacitor/share';
import { Clipboard } from '@capacitor/clipboard';
import { Browser, type OpenOptions } from '@capacitor/browser';
import { LocalNotifications, type LocalNotificationSchema, type PendingResult } from '@capacitor/local-notifications';
import { PushNotifications, type Token, type PushNotificationSchema } from '@capacitor/push-notifications';

// ============================================================================
// Types
// ============================================================================

export type Platform = 'ios' | 'android' | 'web' | 'electron';

export interface PlatformInfo {
  platform: Platform;
  isNative: boolean;
  isWeb: boolean;
  isElectron: boolean;
  isIOS: boolean;
  isAndroid: boolean;
}

export interface StoredFile {
  path: string;
  directory: Directory;
  data: string;
  encoding?: Encoding;
}

export interface NotificationOptions {
  id: number;
  title: string;
  body: string;
  schedule?: {
    at?: Date;
    repeats?: boolean;
    every?: 'year' | 'month' | 'two-weeks' | 'week' | 'day' | 'hour' | 'minute' | 'second';
  };
  sound?: string;
  attachments?: Array<{ id: string; url: string }>;
  actionTypeId?: string;
  extra?: any;
}

// ============================================================================
// Platform Detection
// ============================================================================

export function getPlatformInfo(): PlatformInfo {
  const platform = Capacitor.getPlatform() as Platform;
  
  return {
    platform,
    isNative: Capacitor.isNativePlatform(),
    isWeb: platform === 'web',
    isElectron: typeof window !== 'undefined' && !!(window as any).electron,
    isIOS: platform === 'ios',
    isAndroid: platform === 'android',
  };
}

export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): Platform {
  return Capacitor.getPlatform() as Platform;
}

// ============================================================================
// App Lifecycle
// ============================================================================

export const AppService = {
  async getInfo(): Promise<AppInfo> {
    return App.getInfo();
  },
  
  async getState(): Promise<AppState> {
    return App.getState();
  },
  
  async exitApp(): Promise<void> {
    await App.exitApp();
  },
  
  async minimizeApp(): Promise<void> {
    await App.minimizeApp();
  },
  
  onAppStateChange(callback: (state: AppState) => void): () => void {
    const listenerPromise = App.addListener('appStateChange', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onAppUrlOpen(callback: (data: { url: string }) => void): () => void {
    const listenerPromise = App.addListener('appUrlOpen', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onBackButton(callback: () => void): () => void {
    const listenerPromise = App.addListener('backButton', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onAppRestoredResult(callback: (data: any) => void): () => void {
    const listenerPromise = App.addListener('appRestoredResult', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Device Information
// ============================================================================

export const DeviceService = {
  async getInfo(): Promise<DeviceInfo> {
    return Device.getInfo();
  },
  
  async getBatteryInfo(): Promise<BatteryInfo> {
    return Device.getBatteryInfo();
  },
  
  async getId(): Promise<{ identifier: string }> {
    return Device.getId();
  },
  
  async getLanguageCode(): Promise<{ value: string }> {
    return Device.getLanguageCode();
  },
  
  async getLanguageTag(): Promise<{ value: string }> {
    return Device.getLanguageTag();
  },
};

// ============================================================================
// File System
// ============================================================================

export const FileService = {
  async writeFile(options: {
    path: string;
    data: string;
    directory?: Directory;
    encoding?: Encoding;
    recursive?: boolean;
  }): Promise<WriteFileResult> {
    return Filesystem.writeFile({
      path: options.path,
      data: options.data,
      directory: options.directory || Directory.Data,
      encoding: options.encoding || Encoding.UTF8,
      recursive: options.recursive ?? true,
    });
  },
  
  async readFile(options: {
    path: string;
    directory?: Directory;
    encoding?: Encoding;
  }): Promise<ReadFileResult> {
    return Filesystem.readFile({
      path: options.path,
      directory: options.directory || Directory.Data,
      encoding: options.encoding || Encoding.UTF8,
    });
  },
  
  async deleteFile(options: {
    path: string;
    directory?: Directory;
  }): Promise<void> {
    await Filesystem.deleteFile({
      path: options.path,
      directory: options.directory || Directory.Data,
    });
  },
  
  async mkdir(options: {
    path: string;
    directory?: Directory;
    recursive?: boolean;
  }): Promise<void> {
    await Filesystem.mkdir({
      path: options.path,
      directory: options.directory || Directory.Data,
      recursive: options.recursive ?? true,
    });
  },
  
  async rmdir(options: {
    path: string;
    directory?: Directory;
    recursive?: boolean;
  }): Promise<void> {
    await Filesystem.rmdir({
      path: options.path,
      directory: options.directory || Directory.Data,
      recursive: options.recursive ?? false,
    });
  },
  
  async readdir(options: {
    path: string;
    directory?: Directory;
  }): Promise<{ files: Array<{ name: string; type: string; size: number; ctime?: number; mtime?: number; uri: string }> }> {
    return Filesystem.readdir({
      path: options.path,
      directory: options.directory || Directory.Data,
    });
  },
  
  async stat(options: {
    path: string;
    directory?: Directory;
  }): Promise<{ type: string; size: number; ctime?: number; mtime?: number; uri: string }> {
    return Filesystem.stat({
      path: options.path,
      directory: options.directory || Directory.Data,
    });
  },
  
  async copy(options: {
    from: string;
    to: string;
    directory?: Directory;
    toDirectory?: Directory;
  }): Promise<{ uri: string }> {
    return Filesystem.copy({
      from: options.from,
      to: options.to,
      directory: options.directory || Directory.Data,
      toDirectory: options.toDirectory || options.directory || Directory.Data,
    });
  },
  
  async rename(options: {
    from: string;
    to: string;
    directory?: Directory;
    toDirectory?: Directory;
  }): Promise<void> {
    await Filesystem.rename({
      from: options.from,
      to: options.to,
      directory: options.directory || Directory.Data,
      toDirectory: options.toDirectory || options.directory || Directory.Data,
    });
  },
  
  // Helper to check if file exists
  async exists(options: {
    path: string;
    directory?: Directory;
  }): Promise<boolean> {
    try {
      await Filesystem.stat({
        path: options.path,
        directory: options.directory || Directory.Data,
      });
      return true;
    } catch {
      return false;
    }
  },
  
  // Convenience directories
  Directory,
  Encoding,
};

// ============================================================================
// Preferences (Key-Value Storage)
// ============================================================================

export const PreferencesService = {
  async get(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value;
  },
  
  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  },
  
  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  },
  
  async clear(): Promise<void> {
    await Preferences.clear();
  },
  
  async keys(): Promise<string[]> {
    const { keys } = await Preferences.keys();
    return keys;
  },
  
  // JSON helpers
  async getJSON<T>(key: string): Promise<T | null> {
    const value = await this.get(key);
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },
  
  async setJSON<T>(key: string, value: T): Promise<void> {
    await this.set(key, JSON.stringify(value));
  },
};

// ============================================================================
// Network
// ============================================================================

export const NetworkService = {
  async getStatus(): Promise<ConnectionStatus> {
    return Network.getStatus();
  },
  
  async isOnline(): Promise<boolean> {
    const status = await Network.getStatus();
    return status.connected;
  },
  
  onNetworkStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    const listenerPromise = Network.addListener('networkStatusChange', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Splash Screen
// ============================================================================

export const SplashScreenService = {
  async show(options?: {
    autoHide?: boolean;
    fadeInDuration?: number;
    fadeOutDuration?: number;
    showDuration?: number;
  }): Promise<void> {
    await SplashScreen.show(options);
  },
  
  async hide(options?: {
    fadeOutDuration?: number;
  }): Promise<void> {
    await SplashScreen.hide(options);
  },
};

// ============================================================================
// Status Bar
// ============================================================================

export const StatusBarService = {
  async setStyle(style: 'dark' | 'light' | 'default'): Promise<void> {
    const styleMap = {
      dark: StatusBarStyle.Dark,
      light: StatusBarStyle.Light,
      default: StatusBarStyle.Default,
    };
    await StatusBar.setStyle({ style: styleMap[style] });
  },
  
  async setBackgroundColor(color: string): Promise<void> {
    await StatusBar.setBackgroundColor({ color });
  },
  
  async show(): Promise<void> {
    await StatusBar.show();
  },
  
  async hide(): Promise<void> {
    await StatusBar.hide();
  },
  
  async setOverlaysWebView(overlay: boolean): Promise<void> {
    await StatusBar.setOverlaysWebView({ overlay });
  },
};

// ============================================================================
// Keyboard
// ============================================================================

export const KeyboardService = {
  async show(): Promise<void> {
    await Keyboard.show();
  },
  
  async hide(): Promise<void> {
    await Keyboard.hide();
  },
  
  async setAccessoryBarVisible(visible: boolean): Promise<void> {
    await Keyboard.setAccessoryBarVisible({ isVisible: visible });
  },
  
  async setScroll(disabled: boolean): Promise<void> {
    await Keyboard.setScroll({ isDisabled: disabled });
  },
  
  onKeyboardWillShow(callback: (info: KeyboardInfo) => void): () => void {
    const listenerPromise = Keyboard.addListener('keyboardWillShow', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onKeyboardDidShow(callback: (info: KeyboardInfo) => void): () => void {
    const listenerPromise = Keyboard.addListener('keyboardDidShow', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onKeyboardWillHide(callback: () => void): () => void {
    const listenerPromise = Keyboard.addListener('keyboardWillHide', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onKeyboardDidHide(callback: () => void): () => void {
    const listenerPromise = Keyboard.addListener('keyboardDidHide', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Haptics
// ============================================================================

export const HapticsService = {
  async impact(style: 'heavy' | 'medium' | 'light' = 'medium'): Promise<void> {
    const styleMap = {
      heavy: ImpactStyle.Heavy,
      medium: ImpactStyle.Medium,
      light: ImpactStyle.Light,
    };
    await Haptics.impact({ style: styleMap[style] });
  },
  
  async notification(type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {
    const typeMap = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    await Haptics.notification({ type: typeMap[type] });
  },
  
  async vibrate(duration: number = 300): Promise<void> {
    await Haptics.vibrate({ duration });
  },
  
  async selectionStart(): Promise<void> {
    await Haptics.selectionStart();
  },
  
  async selectionChanged(): Promise<void> {
    await Haptics.selectionChanged();
  },
  
  async selectionEnd(): Promise<void> {
    await Haptics.selectionEnd();
  },
};

// ============================================================================
// Share
// ============================================================================

export const ShareService = {
  async share(options: {
    title?: string;
    text?: string;
    url?: string;
    dialogTitle?: string;
    files?: string[];
  }): Promise<ShareResult> {
    return Share.share(options);
  },
  
  async canShare(): Promise<boolean> {
    const { value } = await Share.canShare();
    return value;
  },
};

// ============================================================================
// Clipboard
// ============================================================================

export const ClipboardService = {
  async write(options: {
    string?: string;
    url?: string;
    image?: string;
  }): Promise<void> {
    await Clipboard.write(options);
  },
  
  async read(): Promise<{ type: string; value: string }> {
    return Clipboard.read();
  },
};

// ============================================================================
// Browser
// ============================================================================

export const BrowserService = {
  async open(options: OpenOptions): Promise<void> {
    await Browser.open(options);
  },
  
  async close(): Promise<void> {
    await Browser.close();
  },
  
  onBrowserFinished(callback: () => void): () => void {
    const listenerPromise = Browser.addListener('browserFinished', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onBrowserPageLoaded(callback: () => void): () => void {
    const listenerPromise = Browser.addListener('browserPageLoaded', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Local Notifications
// ============================================================================

export const LocalNotificationsService = {
  async schedule(notifications: NotificationOptions[]): Promise<void> {
    const mapped: LocalNotificationSchema[] = notifications.map(n => ({
      id: n.id,
      title: n.title,
      body: n.body,
      schedule: n.schedule,
      sound: n.sound,
      attachments: n.attachments,
      actionTypeId: n.actionTypeId,
      extra: n.extra,
    }));
    await LocalNotifications.schedule({ notifications: mapped });
  },
  
  async getPending(): Promise<PendingResult> {
    return LocalNotifications.getPending();
  },
  
  async cancel(notifications: Array<{ id: number }>): Promise<void> {
    await LocalNotifications.cancel({ notifications });
  },
  
  async requestPermissions(): Promise<{ display: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }> {
    return LocalNotifications.requestPermissions();
  },
  
  async checkPermissions(): Promise<{ display: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }> {
    return LocalNotifications.checkPermissions();
  },
  
  onLocalNotificationReceived(callback: (notification: LocalNotificationSchema) => void): () => void {
    const listenerPromise = LocalNotifications.addListener('localNotificationReceived', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onLocalNotificationActionPerformed(callback: (action: { notification: LocalNotificationSchema; actionId: string; inputValue?: string }) => void): () => void {
    const listenerPromise = LocalNotifications.addListener('localNotificationActionPerformed', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Push Notifications
// ============================================================================

export const PushNotificationsService = {
  async register(): Promise<void> {
    await PushNotifications.register();
  },
  
  async requestPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }> {
    return PushNotifications.requestPermissions();
  },
  
  async checkPermissions(): Promise<{ receive: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' }> {
    return PushNotifications.checkPermissions();
  },
  
  onRegistration(callback: (token: Token) => void): () => void {
    const listenerPromise = PushNotifications.addListener('registration', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onRegistrationError(callback: (error: any) => void): () => void {
    const listenerPromise = PushNotifications.addListener('registrationError', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onPushNotificationReceived(callback: (notification: PushNotificationSchema) => void): () => void {
    const listenerPromise = PushNotifications.addListener('pushNotificationReceived', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
  
  onPushNotificationActionPerformed(callback: (action: { notification: PushNotificationSchema; actionId: string; inputValue?: string }) => void): () => void {
    const listenerPromise = PushNotifications.addListener('pushNotificationActionPerformed', callback);
    return () => { listenerPromise.then(listener => listener.remove()); };
  },
};

// ============================================================================
// Unified Platform API
// ============================================================================

export const CapacitorPlatform = {
  // Platform detection
  getPlatformInfo,
  isNativePlatform,
  getPlatform,
  
  // Services
  App: AppService,
  Device: DeviceService,
  File: FileService,
  Preferences: PreferencesService,
  Network: NetworkService,
  SplashScreen: SplashScreenService,
  StatusBar: StatusBarService,
  Keyboard: KeyboardService,
  Haptics: HapticsService,
  Share: ShareService,
  Clipboard: ClipboardService,
  Browser: BrowserService,
  LocalNotifications: LocalNotificationsService,
  PushNotifications: PushNotificationsService,
};

export default CapacitorPlatform;
