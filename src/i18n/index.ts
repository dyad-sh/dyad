import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import all English locale bundles (bundled with the app)
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enChat from "./locales/en/chat.json";
import enHome from "./locales/en/home.json";
import enErrors from "./locales/en/errors.json";

const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    chat: enChat,
    home: enHome,
    errors: enErrors,
  },
  // Additional languages will be added here as translations are completed
  // "zh-CN": { ... },
  // "ja": { ... },
};

i18n.use(initReactI18next).init({
  resources,
  lng: "en", // Default; overridden by user setting on startup
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common", "settings", "chat", "home", "errors"],
  interpolation: {
    escapeValue: false, // React already escapes rendered output
  },
});

export default i18n;
