import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zhCN from "./resources/zh-CN";
import enUS from "./resources/en-US";

export const LOCALE_STORAGE_KEY = "webcli.locale";
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const resources = {
  "zh-CN": {
    translation: zhCN,
  },
  "en-US": {
    translation: enUS,
  },
} as const;

export function isSupportedLocale(value: string | null | undefined): value is AppLocale {
  return Boolean(value && SUPPORTED_LOCALES.includes(value as AppLocale));
}

export function getStoredLocale(): AppLocale | null {
  if (
    typeof window === "undefined" ||
    !window.localStorage ||
    typeof window.localStorage.getItem !== "function"
  ) {
    return null;
  }

  const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isSupportedLocale(value) ? value : null;
}

export function getDefaultLocale(): AppLocale {
  return getStoredLocale() ?? "zh-CN";
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  if (
    typeof window !== "undefined" &&
    window.localStorage &&
    typeof window.localStorage.setItem === "function"
  ) {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }
  await i18n.changeLanguage(locale);
}

export function translate(
  key: string,
  options?: Record<string, unknown>,
): string {
  return i18n.t(key as never, options as never) as unknown as string;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getDefaultLocale(),
  fallbackLng: "zh-CN",
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

export { i18n };
