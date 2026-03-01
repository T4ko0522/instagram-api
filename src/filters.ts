import type {
  MediaItem,
  FilterThresholds,
  BusinessDiscoveryProfile,
  InfluencerCandidate,
} from "./config.js";

// ── Step 4: 高エンゲージメント投稿の抽出 ──

export function filterHighEngagement(
  media: MediaItem[],
  thresholds: FilterThresholds
): MediaItem[] {
  const filtered = media.filter(
    (m) =>
      (m.like_count ?? 0) >= thresholds.minLikes &&
      (m.comments_count ?? 0) >= thresholds.minComments
  );

  // like_count + comments_count の上位 N 件を抽出
  filtered.sort(
    (a, b) =>
      (b.like_count ?? 0) +
      (b.comments_count ?? 0) -
      ((a.like_count ?? 0) + (a.comments_count ?? 0))
  );

  return filtered.slice(0, thresholds.topN);
}

// ── Step 7: インフルエンサースコアリング ──

export function scoreInfluencers(
  profiles: { profile: BusinessDiscoveryProfile; sourceHashtags: string[] }[]
): InfluencerCandidate[] {
  return profiles
    .map(({ profile, sourceHashtags }) => {
      const recentMedia = profile.media?.data ?? [];

      const avgLikes =
        recentMedia.length > 0
          ? recentMedia.reduce((sum, m) => sum + (m.like_count ?? 0), 0) /
            recentMedia.length
          : 0;

      const avgComments =
        recentMedia.length > 0
          ? recentMedia.reduce(
              (sum, m) => sum + (m.comments_count ?? 0),
              0
            ) / recentMedia.length
          : 0;

      const engagementRate =
        profile.followers_count > 0
          ? (avgLikes + avgComments) / profile.followers_count
          : 0;

      // スコア計算:
      //   - エンゲージメント率 (重み 40)
      //   - フォロワー数 (重み 30, 対数スケール)
      //   - フォロー/フォロワー比 (重み 15, 低いほど良い)
      //   - 投稿数 (重み 15, アクティブさ)
      const engagementScore = Math.min(engagementRate * 1000, 40);
      const followerScore = Math.min(
        (Math.log10(Math.max(profile.followers_count, 1)) / 7) * 30,
        30
      );
      const ratioRaw =
        profile.followers_count > 0
          ? profile.follows_count / profile.followers_count
          : 1;
      const ratioScore = Math.max(0, (1 - ratioRaw) * 15);
      const activityScore = Math.min(
        (Math.log10(Math.max(profile.media_count, 1)) / 4) * 15,
        15
      );

      const score =
        Math.round(
          (engagementScore + followerScore + ratioScore + activityScore) * 10
        ) / 10;

      return {
        username: profile.username,
        name: profile.name,
        biography: profile.biography,
        website: profile.website,
        profile_picture_url: profile.profile_picture_url,
        followers_count: profile.followers_count,
        follows_count: profile.follows_count,
        media_count: profile.media_count,
        avg_likes: Math.round(avgLikes),
        avg_comments: Math.round(avgComments),
        engagement_rate: Math.round(engagementRate * 10000) / 10000,
        score,
        source_hashtags: sourceHashtags,
      };
    })
    .filter((c) => {
      // 基本フィルタ: マイクロインフルエンサー以上
      if (c.followers_count < 10_000) return false;
      if (c.engagement_rate < 0.01) return false;
      if (c.media_count < 30) return false;
      if (
        c.followers_count > 0 &&
        c.follows_count / c.followers_count >= 1.0
      )
        return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);
}
