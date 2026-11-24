const countryCodeStorageKey = "webofdevs.countryCode";
const countryCodeLookupTimeoutMs = 3000;
const countryCodeLookupUrl =
  "https://mapledeploy.ca/api/badge?theme=light&size=large";

function normalizeCountryCode(countryCode: string | undefined | null) {
  return countryCode?.trim().toUpperCase() || null;
}

function getStoredCountryCode() {
  try {
    return normalizeCountryCode(sessionStorage.getItem(countryCodeStorageKey));
  } catch {
    return null;
  }
}

function storeCountryCode(countryCode: string) {
  try {
    sessionStorage.setItem(countryCodeStorageKey, countryCode);
  } catch {
    // Storage can be disabled; the lookup still works for this page load.
  }
}

// MapleDeploy's CDN adds the visitor's country to every badge response and
// exposes it to other origins, so fetching the badge doubles as the lookup.
// `no-store` keeps a cached response from answering with an old country.
async function lookupCountryCodeFromBadge() {
  const response = await fetch(countryCodeLookupUrl, {
    cache: "no-store",
    signal: AbortSignal.timeout(countryCodeLookupTimeoutMs),
  });

  if (!response.ok) return null;

  return normalizeCountryCode(response.headers.get("CDN-RequestCountryCode"));
}

/**
 * Returns the visitor's ISO country code, or null when it cannot be
 * determined (lookup blocked, timed out or failed). Cached per session so
 * the lookup runs once per visit.
 */
export async function getVisitorCountryCode() {
  const storedCountryCode = getStoredCountryCode();
  if (storedCountryCode) return storedCountryCode;

  try {
    const countryCode = await lookupCountryCodeFromBadge();

    if (countryCode) {
      storeCountryCode(countryCode);
      return countryCode;
    }
  } catch {
    // A failed lookup falls back to the default (non-Canadian) empty state.
  }

  return null;
}
