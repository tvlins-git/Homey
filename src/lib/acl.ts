export type AccessMode = "always" | "home" | "never";

export const ACCESS_MODES: AccessMode[] = ["always", "home", "never"];

export function isAccessMode(value: unknown): value is AccessMode {
  return value === "always" || value === "home" || value === "never";
}

export function canControl(mode: AccessMode, isHome: boolean): boolean {
  if (mode === "always") return true;
  if (mode === "home") return isHome;
  return false;
}
