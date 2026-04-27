const numberFormatter = new Intl.NumberFormat("en-GB", {
  maximumFractionDigits: 1,
});

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}

export function formatLongDateTime(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  const date = new Date(timestamp * 1000);
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "long" }).format(date);
  const year = date.getFullYear();
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);

  return `${day}${ordinalSuffix(day)} ${month} ${year}, ${time}`;
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

export function formatTime(timestamp: number | null): string {
  if (!timestamp) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
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
