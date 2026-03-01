import type {
  AppConfig,
  BusinessDiscoveryProfile,
  MediaItem,
  MyProfileResponse,
  PipelineResult,
} from "./config.js";
import {
  searchHashtag,
  getHashtagMedia,
  getMediaOwner,
  getUsernameById,
  getBusinessDiscovery,
  getMyProfile,
  getApiCallCount,
  ApiError,
} from "./api.js";
import { filterHighEngagement, scoreInfluencers } from "./filters.js";
import { delay, log } from "./utils.js";

const API_BUDGET = 200;
const DELAY_BETWEEN_CALLS_MS = 500;

export async function runPipeline(config: AppConfig): Promise<PipelineResult> {
  // Step 0: 自分のプロフィール取得（トークン検証を兼ねる）
  let myProfile: MyProfileResponse | null = null;
  try {
    myProfile = await getMyProfile(config);
    log(`Authenticated as @${myProfile.username} (${myProfile.followers_count} followers)`);
    await delay(DELAY_BETWEEN_CALLS_MS);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      throw e;
    }
    log(`Warning: Could not fetch own profile: ${e}`);
  }

  const hashtagsSearched: string[] = [];
  const hashtagsFailed: string[] = [];

  // owner.id → username キャッシュ
  const usernameCache = new Map<string, string>();
  // username → source hashtags のマッピング
  const usernameHashtags = new Map<string, Set<string>>();
  // 収集したプロフィール
  const profileMap = new Map<string, BusinessDiscoveryProfile>();

  for (const hashtag of config.hashtags) {
    if (getApiCallCount() >= API_BUDGET - 10) {
      log(`API budget nearly exhausted (${getApiCallCount()}/${API_BUDGET}). Stopping.`);
      break;
    }

    log(`\n── Processing hashtag: #${hashtag} ──`);

    // Step 2: ハッシュタグ ID 取得
    let hashtagId: string | null;
    try {
      hashtagId = await searchHashtag(config, hashtag);
      await delay(DELAY_BETWEEN_CALLS_MS);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        throw e; // トークン切れは即中断
      }
      log(`Failed to search hashtag #${hashtag}: ${e}`);
      hashtagsFailed.push(hashtag);
      continue;
    }

    if (!hashtagId) {
      log(`Hashtag #${hashtag} not found`);
      hashtagsFailed.push(hashtag);
      continue;
    }

    hashtagsSearched.push(hashtag);

    // Step 3: トップメディア取得
    let allMedia: MediaItem[] = [];
    try {
      const topMedia = await getHashtagMedia(config, hashtagId, "top_media");
      allMedia = topMedia.data ?? [];
      await delay(DELAY_BETWEEN_CALLS_MS);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        throw e;
      }
      log(`Failed to get top_media for #${hashtag}: ${e}`);
      hashtagsFailed.push(hashtag);
      continue;
    }

    log(`Got ${allMedia.length} media items for #${hashtag}`);

    // Step 4: 高エンゲージメント投稿の抽出
    const topMedia = filterHighEngagement(allMedia, config.thresholds);
    log(`Filtered to ${topMedia.length} high-engagement posts`);

    // Step 5: 投稿者の特定
    for (const media of topMedia) {
      if (getApiCallCount() >= API_BUDGET - 5) {
        log("API budget nearly exhausted. Stopping owner resolution.");
        break;
      }

      // Layer 1: media.owner.id がレスポンスに含まれているか
      let ownerId = media.owner?.id ?? null;

      // Layer 2: 含まれていない場合、個別に取得
      if (!ownerId) {
        try {
          ownerId = await getMediaOwner(config, media.id);
          await delay(DELAY_BETWEEN_CALLS_MS);
        } catch (e) {
          log(`Failed to get owner for media ${media.id}: ${e}`);
          continue;
        }
      }

      if (!ownerId) {
        log(`Could not determine owner for media ${media.id}`);
        continue;
      }

      // Layer 3: ownerId → username（キャッシュ利用）
      let username = usernameCache.get(ownerId);
      if (!username) {
        try {
          username = (await getUsernameById(config, ownerId)) ?? undefined;
          await delay(DELAY_BETWEEN_CALLS_MS);
        } catch (e) {
          log(`Failed to resolve username for owner ${ownerId}: ${e}`);
          continue;
        }

        if (username) {
          usernameCache.set(ownerId, username);
        }
      }

      if (!username) {
        log(`Could not resolve username for owner ${ownerId}`);
        continue;
      }

      // ハッシュタグソース追跡
      if (!usernameHashtags.has(username)) {
        usernameHashtags.set(username, new Set());
      }
      usernameHashtags.get(username)!.add(hashtag);

      // 既にプロフィール取得済みならスキップ
      if (profileMap.has(username)) {
        continue;
      }

      // Step 6: Business Discovery でプロフィール取得
      if (getApiCallCount() >= API_BUDGET - 2) {
        log("API budget nearly exhausted. Stopping profile retrieval.");
        break;
      }

      try {
        const discovery = await getBusinessDiscovery(config, username);
        await delay(DELAY_BETWEEN_CALLS_MS);

        if (discovery?.business_discovery) {
          profileMap.set(username, discovery.business_discovery);
          log(`Profile retrieved: @${username} (${discovery.business_discovery.followers_count} followers)`);
        }
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          throw e;
        }
        log(`Failed to get profile for @${username}: ${e}`);
      }
    }
  }

  // Step 7: スコアリング
  const profileEntries = Array.from(profileMap.entries()).map(
    ([username, profile]) => ({
      profile,
      sourceHashtags: Array.from(usernameHashtags.get(username) ?? []),
    })
  );

  const candidates = scoreInfluencers(profileEntries);

  log(`\n── Pipeline complete ──`);
  log(`API calls used: ${getApiCallCount()}`);
  log(`Candidates found: ${candidates.length}`);

  return {
    meta: {
      timestamp: new Date().toISOString(),
      hashtags_searched: hashtagsSearched,
      hashtags_failed: hashtagsFailed,
      api_calls_used: getApiCallCount(),
      candidates_found: candidates.length,
    },
    me: myProfile,
    candidates,
  };
}
