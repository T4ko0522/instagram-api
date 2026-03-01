import type {
  AppConfig,
  HashtagSearchResponse,
  HashtagMediaResponse,
  MediaOwnerResponse,
  UserResponse,
  BusinessDiscoveryResponse,
  MyProfileResponse,
} from "./config.js";
import { delay, log } from "./utils.js";

// ── API エラークラス ──

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`API error ${status}: ${JSON.stringify(body)}`);
    this.name = "ApiError";
  }
}

// ── API コールカウンター ──

let apiCallCount = 0;

export function getApiCallCount(): number {
  return apiCallCount;
}

export function resetApiCallCount(): void {
  apiCallCount = 0;
}

// ── 共通フェッチヘルパー ──

async function apiFetch<T>(url: string): Promise<T> {
  apiCallCount++;
  log(`API call #${apiCallCount}: ${url.replace(/access_token=[^&]+/, "access_token=***")}`);

  const res = await fetch(url);

  if (res.status === 401 || res.status === 403) {
    const body = await res.json().catch(() => res.statusText);
    throw new ApiError(res.status, body);
  }

  if (res.status === 429) {
    log("Rate limited (429). Waiting 60s before retry...");
    await delay(60_000);
    apiCallCount++;
    const retry = await fetch(url);
    if (!retry.ok) {
      const body = await retry.json().catch(() => retry.statusText);
      throw new ApiError(retry.status, body);
    }
    return (await retry.json()) as T;
  }

  if (res.status >= 500) {
    log(`Server error (${res.status}). Waiting 5s before retry...`);
    await delay(5_000);
    apiCallCount++;
    const retry = await fetch(url);
    if (!retry.ok) {
      const body = await retry.json().catch(() => retry.statusText);
      throw new ApiError(retry.status, body);
    }
    return (await retry.json()) as T;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => res.statusText);
    throw new ApiError(res.status, body);
  }

  return (await res.json()) as T;
}

// ── セットアップ: アクセストークンから IG User ID を自動取得 ──

interface FacebookPage {
  id: string;
  name: string;
  instagram_business_account?: { id: string };
}

interface MeAccountsResponse {
  data: FacebookPage[];
  paging?: { next?: string };
}

export async function discoverInstagramUserId(
  apiBaseUrl: string,
  accessToken: string
): Promise<{ pageId: string; pageName: string; igUserId: string } | null> {
  // Step 1: Facebook ページ一覧を取得
  const url =
    `${apiBaseUrl}/me/accounts` +
    `?fields=id,name,instagram_business_account` +
    `&access_token=${accessToken}`;

  const data = await apiFetch<MeAccountsResponse>(url);

  if (!data.data || data.data.length === 0) {
    return null;
  }

  // instagram_business_account が紐づいているページを探す
  for (const page of data.data) {
    if (page.instagram_business_account?.id) {
      return {
        pageId: page.id,
        pageName: page.name,
        igUserId: page.instagram_business_account.id,
      };
    }
  }

  return null;
}

// ── 自分のプロフィール取得 ──

export async function getMyProfile(
  config: AppConfig
): Promise<MyProfileResponse> {
  const fields = [
    "id",
    "username",
    "name",
    "biography",
    "website",
    "profile_picture_url",
    "followers_count",
    "follows_count",
    "media_count",
    "media{id,caption,like_count,comments_count,timestamp,permalink,media_type}",
  ].join(",");

  const url =
    `${config.apiBaseUrl}/${config.userId}` +
    `?fields=${fields}` +
    `&access_token=${config.accessToken}`;

  return apiFetch<MyProfileResponse>(url);
}

// ── Step 2: ハッシュタグ ID 取得 ──

export async function searchHashtag(
  config: AppConfig,
  hashtagName: string
): Promise<string | null> {
  const url =
    `${config.apiBaseUrl}/ig_hashtag_search` +
    `?q=${encodeURIComponent(hashtagName)}` +
    `&user_id=${config.userId}` +
    `&access_token=${config.accessToken}`;

  const data = await apiFetch<HashtagSearchResponse>(url);
  return data.data?.[0]?.id ?? null;
}

// ── Step 3: ハッシュタグメディア取得 ──

export async function getHashtagMedia(
  config: AppConfig,
  hashtagId: string,
  type: "top_media" | "recent_media" = "top_media"
): Promise<HashtagMediaResponse> {
  const fields = "id,permalink,like_count,comments_count,media_type,caption,timestamp,owner{id}";
  const url =
    `${config.apiBaseUrl}/${hashtagId}/${type}` +
    `?user_id=${config.userId}` +
    `&fields=${fields}` +
    `&access_token=${config.accessToken}`;

  return apiFetch<HashtagMediaResponse>(url);
}

// ── Step 5 fallback: 個別メディアから owner.id 取得 ──

export async function getMediaOwner(
  config: AppConfig,
  mediaId: string
): Promise<string | null> {
  const url =
    `${config.apiBaseUrl}/${mediaId}` +
    `?fields=owner{id}` +
    `&access_token=${config.accessToken}`;

  const data = await apiFetch<MediaOwnerResponse>(url);
  return data.owner?.id ?? null;
}

// ── Step 5: owner.id → username 解決 ──

export async function getUsernameById(
  config: AppConfig,
  ownerId: string
): Promise<string | null> {
  const url =
    `${config.apiBaseUrl}/${ownerId}` +
    `?fields=username` +
    `&access_token=${config.accessToken}`;

  try {
    const data = await apiFetch<UserResponse>(url);
    return data.username ?? null;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 404)) {
      return null;
    }
    throw e;
  }
}

// ── Step 6: Business Discovery でプロフィール詳細取得 ──

export async function getBusinessDiscovery(
  config: AppConfig,
  targetUsername: string
): Promise<BusinessDiscoveryResponse | null> {
  const discoveryFields = [
    "id",
    "username",
    "name",
    "biography",
    "website",
    "profile_picture_url",
    "followers_count",
    "follows_count",
    "media_count",
    "media{like_count,comments_count,permalink,caption,timestamp}",
  ].join(",");

  const url =
    `${config.apiBaseUrl}/${config.userId}` +
    `?fields=business_discovery.username(${encodeURIComponent(targetUsername)}){${discoveryFields}}` +
    `&access_token=${config.accessToken}`;

  try {
    return await apiFetch<BusinessDiscoveryResponse>(url);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      log(`Skipping @${targetUsername}: not a Business/Creator account or not found`);
      return null;
    }
    throw e;
  }
}
