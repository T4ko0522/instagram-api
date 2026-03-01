// ── API レスポンス型定義 ──

export interface HashtagSearchResponse {
  data: { id: string }[];
}

export interface MediaItem {
  id: string;
  permalink?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  caption?: string;
  timestamp?: string;
  owner?: { id: string };
}

export interface HashtagMediaResponse {
  data: MediaItem[];
  paging?: { next?: string };
}

export interface MediaOwnerResponse {
  id: string;
  owner?: { id: string };
}

export interface UserResponse {
  id: string;
  username: string;
}

export interface BusinessDiscoveryProfile {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  media?: {
    data: {
      like_count?: number;
      comments_count?: number;
      permalink?: string;
      caption?: string;
      timestamp?: string;
    }[];
  };
}

export interface BusinessDiscoveryResponse {
  business_discovery: BusinessDiscoveryProfile;
  id: string;
}

export interface MyProfileResponse {
  id: string;
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  media?: {
    data: {
      id: string;
      caption?: string;
      like_count?: number;
      comments_count?: number;
      timestamp?: string;
      permalink?: string;
      media_type?: string;
    }[];
  };
}

// ── アプリケーション内部型 ──

export interface FilterThresholds {
  minLikes: number;
  minComments: number;
  topN: number;
}

export interface InfluencerCandidate {
  username: string;
  name?: string;
  biography?: string;
  website?: string;
  profile_picture_url?: string;
  followers_count: number;
  follows_count: number;
  media_count: number;
  avg_likes: number;
  avg_comments: number;
  engagement_rate: number;
  score: number;
  source_hashtags: string[];
}

export interface PipelineResult {
  meta: {
    timestamp: string;
    hashtags_searched: string[];
    hashtags_failed: string[];
    api_calls_used: number;
    candidates_found: number;
  };
  me: MyProfileResponse | null;
  candidates: InfluencerCandidate[];
}

export interface AppConfig {
  accessToken: string;
  userId: string;
  hashtags: string[];
  thresholds: FilterThresholds;
  apiBaseUrl: string;
}

// ── 定数 ──

export const API_BASE_URL = "https://graph.facebook.com/v22.0";

export const DEFAULT_HASHTAGS = [
  "fashion",
  "ootd",
  "streetstyle",
  "beauty",
  "skincare",
  "makeup",
  "fitness",
  "workout",
  "gym",
];

export const DEFAULT_THRESHOLDS: FilterThresholds = {
  minLikes: 1000,
  minComments: 50,
  topN: 10,
};

// ── 設定読み込み ──

export function loadConfig(): AppConfig {
  const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;

  if (!accessToken) {
    throw new Error(
      "INSTAGRAM_ACCESS_TOKEN is not set. Check your .env file."
    );
  }
  if (!userId) {
    throw new Error(
      "INSTAGRAM_USER_ID is not set. Run 'npm start -- --setup' to discover it automatically."
    );
  }

  // CLI 引数パース: --hashtags fashion,beauty or --hashtags fashion beauty
  // Windows の cmd.exe ではカンマが引数区切りになるため、
  // --hashtags 以降の非フラグ引数をすべて収集する
  const args = process.argv.slice(2);
  let hashtags = DEFAULT_HASHTAGS;

  const hashtagIdx = args.indexOf("--hashtags");
  if (hashtagIdx !== -1) {
    const raw: string[] = [];
    for (let i = hashtagIdx + 1; i < args.length; i++) {
      if (args[i].startsWith("--")) break;
      raw.push(args[i]);
    }
    const parsed = raw
      .flatMap((a) => a.split(","))
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);
    if (parsed.length > 0) {
      hashtags = parsed;
    }
  }

  return {
    accessToken,
    userId,
    hashtags,
    thresholds: { ...DEFAULT_THRESHOLDS },
    apiBaseUrl: API_BASE_URL,
  };
}
