## 目的

* **Instagram公式API**を使い、**上位インフルエンサー**を無作為に収集する方法を調査する。
* **”Instagram全体の上位インフルエンサー一覧を直接取得”は不可**のため、代替となる方法を探す。

---

## データ収集フロー（手順）

Instagram Graph API には「トップインフルエンサー一覧」を直接返すエンドポイントが存在しない。
そのため、**ハッシュタグを起点に投稿→投稿者→プロフィールと辿る**間接的なアプローチを採用する。

```
Step 1  ハッシュタグリスト設計
  ↓
Step 2  ハッシュタグ ID 取得
  ↓
Step 3  トップ投稿・最新投稿の取得
  ↓
Step 4  高エンゲージメント投稿の抽出
  ↓
Step 5  投稿者の特定
  ↓
Step 6  プロフィール詳細の取得
  ↓
Step 7  インフルエンサー候補の選定
```

### Step 1: ハッシュタグリスト設計

探索したいジャンルごとにハッシュタグを事前に設計する。

```
例:
  ファッション → #fashion, #ootd, #streetstyle
  美容       → #beauty, #skincare, #makeup
  フィットネス → #fitness, #workout, #gym
```

- 1週間で使えるハッシュタグは **30個まで** なので、ジャンル配分を計画する
- 「無作為」を実現するには、人気タグとニッチタグを混ぜてバイアスを軽減する

### Step 2: ハッシュタグ ID 取得

```
GET /ig_hashtag_search?q={hashtag_name}&user_id={ig-user-id}
```

| 項目 | 内容 |
|---|---|
| レスポンス | ハッシュタグの内部 ID |
| 制約 | **30 ユニークハッシュタグ / 7日間（ローリング）** |
| 注意 | 絵文字ハッシュタグ・センシティブなタグは取得不可 |

### Step 3: トップ投稿・最新投稿の取得

```
GET /{ig-hashtag-id}/top_media?user_id={ig-user-id}&fields=id,permalink,like_count,comments_count,media_type,caption,timestamp
GET /{ig-hashtag-id}/recent_media?user_id={ig-user-id}&fields=id,permalink,like_count,comments_count,media_type,caption,timestamp
```

| 項目 | 内容 |
|---|---|
| `top_media` | Instagram が選定した人気投稿（エンゲージメントが高い順とは限らない） |
| `recent_media` | 最新の投稿（時系列） |
| 1リクエストあたり | 最大 **50件**。`paging.next` で追加ページ取得可 |
| 取得できるフィールド | `id`, `permalink`, `like_count`, `comments_count`, `media_type`, `caption`, `timestamp` |

### Step 4: 高エンゲージメント投稿の抽出

取得した投稿をアプリケーション側でフィルタリングする（API にソート機能はない）。

```
フィルタ例:
  - like_count >= 1,000
  - comments_count >= 50
  - like_count + comments_count の上位 N 件を抽出
```

### Step 5: 投稿者の特定

`top_media` / `recent_media` のレスポンスには投稿者の `username` が直接含まれない場合がある。

| 方法 | 手順 | コスト |
|---|---|---|
| `owner.id` から取得 | レスポンスに含まれる `owner.id` を使って追加 API コールでユーザー情報を取得 | 1投稿につき **+1 API コール** |
| `permalink` からパース | `https://www.instagram.com/p/{SHORTCODE}/` 形式のためユーザー名は含まれない | 直接取得は不可 |

→ 実質的に `owner.id` 経由の追加リクエストが必要となり、**レート制限を大きく消費する**。

### Step 6: プロフィール詳細の取得（Business Discovery API）

Step 5 で特定した `username` を使い、Business Discovery API でプロフィールを取得する。

```
GET /{ig-user-id}?fields=business_discovery.username({target_username}){
  id,username,name,biography,website,profile_picture_url,
  followers_count,follows_count,media_count,
  media{like_count,comments_count,permalink,caption,timestamp}
}
```

| 取得フィールド | 用途 |
|---|---|
| `followers_count` | フォロワー数でインフルエンサー規模を判定 |
| `follows_count` | フォロー/フォロワー比率の算出 |
| `media_count` | 投稿頻度の指標 |
| `biography`, `website` | ジャンル・活動内容の判定材料 |
| `media.like_count`, `media.comments_count` | エンゲージメント率の算出 |

**制約**: Business / Creator アカウントのみ取得可能。個人アカウントはエラーになる。

### Step 7: インフルエンサー候補の選定

取得したプロフィールデータをもとに、アプリケーション側でスコアリング・フィルタリングする。

```
フィルタ例:
  - followers_count >= 10,000（マイクロインフルエンサー以上）
  - エンゲージメント率 = (avg_likes + avg_comments) / followers_count >= 1%
  - media_count >= 30（アクティブなアカウント）
  - follows_count / followers_count < 1.0（フォロバ業者を除外）
```

### まとめ

| 項目 | 見積もり |
|---|---|
| 1時間あたり API コール | 200回 |
| Step 2〜3 で消費 | ハッシュタグ数 x 1〜2 コール |
| Step 5〜6 で消費 | 候補数 x 2 コール（ユーザー特定 + プロフィール取得） |
| **1時間あたり最大プロフィール取得** | **約 80〜100件**（Step 2〜5 の消費を考慮） |
| 1週間あたり探索可能ハッシュタグ | 30個 |
| 1週間あたりの理論最大候補数 | 30 タグ x 50 件 = 1,500 投稿 → 重複除去後の実効候補数はこれ以下 |

---

## API の制限事項

### レート制限

| 制限項目 | 値 |
|---|---|
| API コール | **200回 / ユーザー / 1時間** |
| ハッシュタグ検索 | **30 ユニークハッシュタグ / 7日間 / アカウント** |
| ハッシュタグ検索結果 | 最大 50件 / リクエスト（ページネーション可） |

- 成功・失敗に関わらず全リクエストがカウントされる
- 2025年にレート制限が大幅引き下げ（5,000回/時 → 200回/時）

### データ取得の制約

| 制約 | 詳細 |
|---|---|
| 対象アカウント | **Business / Creator のみ**。個人アカウントは取得不可 |
| 全体ランキング | 「Instagram 全体のトップユーザー一覧」を返すエンドポイントは存在しない |
| ソート非対応 | API の結果を並び替え（Ordering）する機能がない |
| ユーザー名取得 | `top_media` の結果に投稿者の `username` が直接含まれない場合がある |
| Stories | ハッシュタグ経由での Stories 取得は非対応 |
| Basic Display API | 2024年12月に廃止済み。Graph API への移行が必須 |

---

## サンプルコードを動かすために必要な条件

### 前提条件

公式 Instagram Graph API を利用するために、以下が必要。

#### アカウント・サービス

| 必要なもの | 説明 |
|---|---|
| Instagram Business or Creator アカウント | 個人アカウントでは API を利用できない（下記 FAQ 参照） |
| Facebook ページ | Instagram アカウントと連携済みであること |
| Meta (Facebook) Developer アカウント | [developers.facebook.com](https://developers.facebook.com/) で作成 |
| Facebook App | Developer ダッシュボードで作成・設定 |
| App Review（アプリ審査） | 本番環境で他者のデータにアクセスする場合に必須（1週間以上） |

[アカウント切り替え方法](https://help.instagram.com/502981923235522)

また、Business Discovery API で他者のデータを取得する場合も、**対象が Business / Creator アカウントでなければエラーになる**。つまり API の呼び出し側・対象側の双方が Business / Creator であることが条件。

> ただし、実際のインフルエンサーの多くは Business / Creator アカウントを利用しているため、実用上の影響は限定的。

- 切り替えは**無料**
- 非公開アカウントの場合、切り替え時に**公開アカウントになる**

出典（公式）:
- [Instagram Graph API 概要](https://developers.facebook.com/docs/instagram-api/)
- [Instagram API Getting Started](https://developers.facebook.com/docs/instagram-api/getting-started)
- [Business Discovery ガイド](https://developers.facebook.com/docs/instagram-api/guides/business-discovery)
- [プロフェッショナルアカウントの設定](https://help.instagram.com/502981923235522)
- [Business と Creator アカウントについて](https://help.instagram.com/138925576505882)

#### 認証・トークン

| トークン種別 | 有効期限 | 用途 |
|---|---|---|
| 短期トークン | 1時間 | テスト・開発用 |
| 長期トークン | 60日 | 本番環境向け。定期更新が必要 |
| ページアクセストークン | 無期限取得可 | Facebook ページ経由の認証 |

認証方式は **Business Login（OAuth 2.0）** または **Facebook Login** の2種類。

### 環境変数の取得手順

このツールの実行には `.env` ファイルに以下の2つの値が必要。

```
INSTAGRAM_ACCESS_TOKEN=your_access_token_here
INSTAGRAM_USER_ID=your_ig_user_id_here
```

#### 1. INSTAGRAM_ACCESS_TOKEN の取得

**方法 A: Graph API Explorer（開発・テスト用 / 短期トークン）**

1. [Graph API Explorer](https://developers.facebook.com/tools/explorer/) を開く
2. 右上の「Meta App」で自分のアプリを選択
3. 「User or Page」で **User Token** を選択
4. 「Permissions」で以下を追加:
   - `instagram_basic`
   - `instagram_manage_insights`
   - `pages_show_list`
   - `pages_read_engagement`
   - `business_management`（`me/accounts` や `instagram_business_account` の取得に必要）
5. 「Generate Access Token」をクリックし、Facebook/Instagram 認可を完了
6. 表示されるトークンが `INSTAGRAM_ACCESS_TOKEN`（有効期限: **約1時間**）

**方法 B: 長期トークンへの交換（本番用 / 60日間有効）**

短期トークンを取得後、以下のエンドポイントで長期トークンに交換する:

```
GET https://graph.facebook.com/v22.0/oauth/access_token
  ?grant_type=fb_exchange_token
  &client_id={app-id}
  &client_secret={app-secret}
  &fb_exchange_token={short-lived-token}
```

- `{app-id}` / `{app-secret}` は [アプリダッシュボード](https://developers.facebook.com/apps/) の「設定 > ベーシック」から取得
- レスポンスの `access_token` が長期トークン（有効期限: **60日**）

#### 2. INSTAGRAM_USER_ID の取得

`INSTAGRAM_USER_ID` は Instagram Business/Creator アカウントの **Graph API 上の ID**（Instagram アプリ上の表示名やユーザー名ではない）。

**手順:**

1. 上記で取得したアクセストークンを使い、自分の Facebook ページ一覧を取得:

```
GET https://graph.facebook.com/v22.0/me/accounts?access_token={token}
```

2. レスポンスからページの `id` を確認:

```json
{
  "data": [
    {
      "id": "123456789",
      "name": "My Page"
    }
  ]
}
```

3. ページ ID を使って、紐づいている Instagram Business アカウント ID を取得:

```
GET https://graph.facebook.com/v22.0/{page-id}?fields=instagram_business_account&access_token={token}
```

4. レスポンスの `instagram_business_account.id` が `INSTAGRAM_USER_ID`:

```json
{
  "instagram_business_account": {
    "id": "17841400000000000"
  },
  "id": "123456789"
}
```

> **注意**: Instagram アカウントが Facebook ページにリンクされていない場合、`instagram_business_account` フィールドが返されない。[Instagram アカウントと Facebook ページのリンク方法](https://help.instagram.com/570895513091465)を参照。

### 必要なパーミッション

| パーミッション | 用途 |
|---|---|
| `instagram_basic` | プロフィール・メディアデータの読み取り |
| `instagram_manage_insights` | アナリティクスデータの取得 |
| `pages_show_list` | Facebook ページ一覧へのアクセス |
| `pages_read_engagement` | ページエンゲージメントの読み取り |

### 実行方法

1. **Node.js** をインストールする（推奨: v18 以上）
2. リポジトリをクローンし、依存関係をインストールする:

```bash
npm install
```

3. プロジェクトルートに `.env` を作成し、上記「環境変数の取得手順」に従って `INSTAGRAM_ACCESS_TOKEN` と `INSTAGRAM_USER_ID` を設定する（`.env.example` をコピーして編集してもよい）
4. 以下で実行する:

```bash
npm start
```
