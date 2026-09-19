import { currentTimeZoneMode } from "../app/timeZone";

const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatNetworth(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  if (value >= 1_000_000_000) {
    return `${formatFixedCompact(value / 1_000_000_000)}b`;
  }

  return `${formatFixedCompact(value / 1_000_000)}m`;
}

function formatFixedCompact(value: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...timeZoneFormatOptions(),
  }).format(new Date(timestamp * 1000))}${timeZoneSuffix()}`;
}

export function formatLongDateTime(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    ...timeZoneFormatOptions(),
  }).formatToParts(date);
  const day = Number(datePart(parts, "day"));
  const month = datePart(parts, "month");
  const year = datePart(parts, "year");
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...timeZoneFormatOptions(),
  }).format(date);

  return `${day}${ordinalSuffix(day)} ${month} ${year}, ${time}${timeZoneSuffix()}`;
}

export function formatWarDateRange(
  start: number | null,
  finish: number | null,
  openLabel = "Ongoing",
): string {
  if (!finish) {
    return `${formatLongDateTime(start)} - ${openLabel}`;
  }

  return `${formatLongDateTime(start)} - ${formatLongDateTime(finish)}`;
}

export function formatTime(timestamp: number | null, includeSeconds = false): string {
  if (!timestamp) {
    return "-";
  }

  return `${new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    ...timeZoneFormatOptions(),
  }).format(new Date(timestamp * 1000))}${timeZoneSuffix()}`;
}

function timeZoneFormatOptions(): { timeZone?: "UTC" } {
  return currentTimeZoneMode() === "utc" ? { timeZone: "UTC" } : {};
}

function timeZoneSuffix(): string {
  return currentTimeZoneMode() === "utc" ? " UTC" : "";
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

export function formatRelativeTime(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  const minutes = Math.floor(elapsedSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) {
    return "Just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  if (hours < 48) {
    return `${hours}h ago`;
  }

  return `${days}d ago`;
}

function ordinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) {
    return "th";
  }

  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

export function detailNumber(
  value: number | null | undefined,
  fallback: number | null | undefined,
): number {
  return Number(value ?? fallback ?? 0);
}
