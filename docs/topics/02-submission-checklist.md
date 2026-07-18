# 02 — 提出チェックリスト

出典: 主に `talk4.md`, `talk10.md`, `talk11.md`

凡例: `[FAQ]` 対話が必須要件として記録 / `[戦略]` 対話内の推奨 / `[候補依存]` 提出案が確定すると変わる

> 必須性・期限・共有先は提出直前に Devpost 原文で再確認する。

---

## 必須提出物（対話上のFAQ記録）

| # | 提出物 | 審査側が確認すること |
|---|--------|---------------------|
| 1 | 動作するプロジェクト | 起動・一貫動作 |
| 2 | 英語のプロジェクト説明 | 問題・価値・技術 |
| 3 | **3分未満の公開 YouTube** | 動くか、価値が一瞬で分かるか |
| 4 | GitHub 等リポジトリ | GPT-5.6統合と実装深度 |
| 5 | README | 再現・役割分担・既存vs新規 |
| 6 | Codex/GPT-5.6 使用説明 | 実質利用の証明 |
| 7 | **中核開発の `/feedback` Session ID** | 主要スレッドで多数の中核を構築 |
| 8 | 試せるデモ／テスト手順 | 無料・制限なしアクセス |

**鉄則:** 動画・コード・README・Session ID が同一ストーリーであること [戦略]。

---

## 動画

| 要件 | 内容 |
|------|------|
| 公開 YouTube | 必須 |
| 長さ | Rules「3分未満」／FAQ「3分以下」→ **2:40〜2:50 推奨**。超過は見る義務なし |
| 必須内容 | 動くデモ + **音声ナレーション** + 何を作ったか + Codex使い方 + GPT-5.6使い方 |
| BGMのみ | 不可。AI音声は可 |

### 推奨構成 [戦略]

| 区間 | 内容 |
|------|------|
| 0:00–0:20 | 誰の何問題 |
| 0:20–1:30 | 最強フロー（縦一本） |
| 1:30–2:05 | GPT-5.6 内部処理 |
| 2:05–2:35 | Codex 中核 |
| 2:35–2:50 | 結果・差別化 |

Living Decisions を選ぶ場合のデモ核（`talk11`枝）[候補依存]:

```
Private context
→ Permissioned evidence
→ Shared decision
→ Explicit assumptions
→ External event
→ Assumption invalidated
→ Decision reopened
```

---

## README 推奨構造 [戦略]

1. 問題と対象ユーザー
2. プロダクトが行うこと
3. アーキテクチャ
4. GPT-5.6 呼び出し箇所（入出力・後処理）
5. Codex が担当した作業
6. **人間の重要設計判断**
7. セットアップ / テスト / サンプル
8. 既知の制約
9. 既存 vs 期間中新規の区別
10. 「Work completed during Build Week」

「Codexが全部作りました」のみは悪手（人間判断が見えない）。

---

## `/feedback` Session ID

- 対象: *Project thread where the majority of core functionality was built*
- Codex CLI 可。`codex exec` 単発の大量分散は不利 → **メイン対話を1本**に集約
- Devpost Hackathons Plugin は任意（勝敗非影響）。Official Rules 優先

---

## リポジトリ・デモ維持

| 項目 | 内容 |
|------|------|
| Public | 可。relevant licensing 必要 [FAQ] |
| Private | 対話では `testing@devpost.com` と `build-week-event@openai.com` に共有 [FAQ・公式再確認要] |
| 維持期限 | Judging Period 終了（**8/5 17:00 PT**）まで無料・制限なし [FAQ] |
| 事故例 | 招待必須、クレカ必須、API上限、PW失効、ホス停止、ローカルのみ、空データ [戦略] |

開発開始時推奨手順 [戦略]:

```
Join → 新規repo → git tag build-week-baseline → Draft → primary Codex thread
```

### 審査用credentialとAPIキー

**Why:** 規約は審査期間終了まで無料かつ制限なしのテストアクセスを要求する。審査員へBYOKを要求しない。一方、審査用credentialがGalleryや公開説明へ露出すると、第三者によるAPI費用濫用が起こり得る。

**What:**

- 一般利用者はBYOK
- 審査専用ユーザーはserver-funded judge mode
- production APIキーはCloudflare Worker Secret
- credentialは公開README・動画・公開説明欄へ記載しない

**How:**

1. Devpostの`Testing Instructions`をcredentialの第一候補とする。
2. 入力後、提出プレビューとログアウト状態で一般公開されないことを実確認する。
3. 非公開性を確認できない場合、審査共有済みprivate repositoryまたは運営指定の非公開経路から案内する。
4. credentialは漏洩前提で、アカウント・IP・会議数・Realtime時間・token・日次総額をhard limitする。
5. judge mode以外のユーザーへserver-funded keyを使用させない。
6. 8/5 17:00 PT以降にcredential失効とSecret rotateを行う。

Devpostの一般的なTesting GuideはSubmission formの`Testing Instructions`でlogin credentialを収集する運用を案内している。ただし、このハッカソン固有フォームの公開範囲を保証する記述ではないため、実画面確認を省略しない。

---

## 英語

提出するほぼすべての資料に英語または英訳。実務: README・主要UI・テストデータ・エラー・インストール・ナレーション／字幕。

---

## Devpost フロー（`talk10`）

1. **Join Hackathon**（アイデア未確定でも可）
2. **Draft Submission**（締切まで編集可）
3. **Final Submit**（動画・repo・Session ID 等）

締切後は原則変更不可。Draft は締切前保存可。

---

## 提出直前チェック

- [ ] YouTube Public・音声可聴
- [ ] repo権限／デモURLがシークレットで開く
- [ ] テスト認証情報有効・ホス 8/5 まで維持設計
- [ ] 審査ユーザーがBYOKなしでFlagshipを完走
- [ ] Testing Instructionsをログアウト状態で確認し、credentialが一般公開されない
- [ ] judge modeの費用hard limitと一般ユーザー拒否を確認
- [ ] production APIキーがCloudflare Secretにあり、repo・vars・ログにない
- [ ] 提出コミット push・**Gitタグ固定**
- [ ] Session ID が中核スレッド
- [ ] READMEコマンドを別環境で再現
- [ ] 英訳揃い・カテゴリと実装一致
- [ ] Rules/Updates 再確認（提出2日前＋直前）
- [ ] 動画に第三者商標・著作権音楽なし

---

## 関連

- ルール本体: [01-hackathon-rules.md](./01-hackathon-rules.md)
- IP: [03-ip-and-license.md](./03-ip-and-license.md)
- MVPスコープ: [13-mvp-scope.md](./13-mvp-scope.md)
