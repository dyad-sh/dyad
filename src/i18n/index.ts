import i18n from "i18next";
import { initReactI18next } from "react-i18next";

// Import all English locale bundles (bundled with the app)
import enCommon from "./locales/en/common.json";
import enSettings from "./locales/en/settings.json";
import enChat from "./locales/en/chat.json";
import enHome from "./locales/en/home.json";
import enErrors from "./locales/en/errors.json";

// Chinese Simplified
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNSettings from "./locales/zh-CN/settings.json";
import zhCNChat from "./locales/zh-CN/chat.json";
import zhCNHome from "./locales/zh-CN/home.json";
import zhCNErrors from "./locales/zh-CN/errors.json";

// Brazilian Portuguese
import ptBRCommon from "./locales/pt-BR/common.json";
import ptBRSettings from "./locales/pt-BR/settings.json";
import ptBRChat from "./locales/pt-BR/chat.json";
import ptBRHome from "./locales/pt-BR/home.json";
import ptBRErrors from "./locales/pt-BR/errors.json";

// Spanish
import esCommon from "./locales/es/common.json";
import esSettings from "./locales/es/settings.json";
import esChat from "./locales/es/chat.json";
import esHome from "./locales/es/home.json";
import esErrors from "./locales/es/errors.json";

const resources = {
  en: {
    common: enCommon,
    settings: enSettings,
    chat: enChat,
    home: enHome,
    errors: enErrors,
  },
  "zh-CN": {
    common: zhCNCommon,
    settings: zhCNSettings,
    chat: zhCNChat,
    home: zhCNHome,
    errors: zhCNErrors,
  },
  "pt-BR": {
    common: ptBRCommon,
    settings: ptBRSettings,
    chat: ptBRChat,
    home: ptBRHome,
    errors: ptBRErrors,
  },
  es: {
    common: esCommon,
    settings: esSettings,
    chat: esChat,
    home: esHome,
    errors: esErrors,
  },
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
