import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type AppLocale, setAppLocale, SUPPORTED_LOCALES } from "./init";

export function useAppLocale() {
  const { t, i18n } = useTranslation();

  return useMemo(
    () => ({
      t,
      locale: (SUPPORTED_LOCALES.includes(i18n.language as AppLocale)
        ? i18n.language
        : "zh-CN") as AppLocale,
      setLocale: (locale: AppLocale) => setAppLocale(locale),
    }),
    [t, i18n.language],
  );
}
