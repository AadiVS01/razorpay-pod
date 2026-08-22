import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export function getImagesForColor(
  color: string | undefined | null,
  colorImages?: Record<string, string[]> | null,
  defaultImages: string[] = []
): string[] {
  if (!colorImages || !color) return defaultImages;

  if (colorImages[color] && colorImages[color].length > 0) {
    return colorImages[color];
  }

  const normalizedColor = color.trim().toLowerCase();
  const matchedKey = Object.keys(colorImages).find(
    (k) => k.trim().toLowerCase() === normalizedColor
  );

  if (matchedKey && colorImages[matchedKey] && colorImages[matchedKey].length > 0) {
    return colorImages[matchedKey];
  }

  return defaultImages;
}
