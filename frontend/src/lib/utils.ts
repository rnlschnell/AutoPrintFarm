import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as currency (USD)
 */
export function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

/**
 * Format a number with commas
 */
export function formatNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) return "0";
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Format time in minutes to human-readable format (e.g., "2h 30m")
 */
export function formatTime(minutes: number | undefined | null): string {
  if (minutes === undefined || minutes === null || minutes <= 0) return "0m";

  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Format layer progress (e.g., "125 / 300")
 */
export function formatLayerProgress(
  currentLayer: number | undefined | null,
  totalLayers: number | undefined | null
): string {
  const current = currentLayer ?? 0;
  const total = totalLayers ?? 0;
  return `${current} / ${total}`;
}
