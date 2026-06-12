import { IS_TAURI } from "./api";
import pkg from "../../package.json";

const REPO = "benoneill66/strata";
const RELEASES_PAGE = `https://github.com/${REPO}/releases`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface UpdateInfo {
  /** Version of the running app. */
  current: string;
  /** Latest published release version, or null if the check failed. */
  latest: string | null;
  /** True when `latest` is strictly newer than `current`. */
  updateAvailable: boolean;
  /** Page to open to download the update (the release, or the releases list). */
  url: string;
}

/** Version of the running app — from tauri.conf.json at runtime, package.json in dev. */
export async function appVersion(): Promise<string> {
  if (IS_TAURI) {
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  }
  return pkg.version;
}

/** Compare two semver strings; >0 if a is newer than b. Tolerates a leading `v`. */
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Check GitHub Releases for a newer version than the one running. The GitHub
 * API allows CORS, so this runs from the webview with no backend command and
 * no auth (unauthenticated rate limit is plenty for an occasional check).
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = await appVersion();
  const res = await fetch(LATEST_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const data = (await res.json()) as { tag_name?: string; html_url?: string };
  const latest = (data.tag_name ?? "").replace(/^v/, "") || null;
  return {
    current,
    latest,
    updateAvailable: latest != null && compareVersions(latest, current) > 0,
    url: data.html_url || RELEASES_PAGE,
  };
}
