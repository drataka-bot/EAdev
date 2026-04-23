import type { AppSettings } from "../types";

const KEY = "sedori_tool_settings_v2";

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      return {
        apiKey: parsed.apiKey ?? "",
        rakutenAppId: parsed.rakutenAppId ?? "",
        yahooClientId: parsed.yahooClientId ?? "",
        defaultPurchasePrice:
          typeof parsed.defaultPurchasePrice === "number"
            ? parsed.defaultPurchasePrice
            : null,
      };
    }
  } catch {
    // noop
  }
  return {
    apiKey: "",
    rakutenAppId: "",
    yahooClientId: "",
    defaultPurchasePrice: null,
  };
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
