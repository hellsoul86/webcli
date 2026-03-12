import { i18n, translate, type AppLocale } from "./init";

export function getActiveLocale(): AppLocale {
  return i18n.language === "en-US" ? "en-US" : "zh-CN";
}

export function formatNumber(value: number, locale = getActiveLocale()): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(
  value: number,
  locale = getActiveLocale(),
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits,
  }).format(value);
}

export function formatDateTime(
  value: number,
  locale = getActiveLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeShort(
  value: number,
  now = Date.now(),
  locale = getActiveLocale(),
): string {
  const delta = Math.max(0, now - value);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;
  const count = (size: number) => Math.max(1, Math.floor(delta / size));

  if (delta < minute) {
    return translate("time.now", { lng: locale });
  }
  if (delta < hour) {
    return translate("time.minute", {
      lng: locale,
      count: count(minute),
    });
  }
  if (delta < day) {
    return translate("time.hour", {
      lng: locale,
      count: count(hour),
    });
  }
  if (delta < week) {
    return translate("time.day", {
      lng: locale,
      count: count(day),
    });
  }
  if (delta < month) {
    return translate("time.week", {
      lng: locale,
      count: count(week),
    });
  }
  if (delta < year) {
    return translate("time.month", {
      lng: locale,
      count: count(month),
    });
  }
  return translate("time.year", {
    lng: locale,
    count: count(year),
  });
}
