# 13 — ハッカソン MVP スコープ

出典: `talk8.md`, `talk11.md`／別枝の縮小案は `talk3`/`talk4`

> **ステータス: 未確定候補。** 以下は talk11枝で Living Decisions を選ぶ場合のMVP案であり、全枝横断の確定スコープではない。誤概念診断・Executable Falsifier・Promise Compiler は排除されていない。

> **横断的統合:** Private/Shared/Commitment と状態モデルは talk6→talk7、talk8、talk11 の概念を統合した設計案。原対話上で単一スキーマに統合済みではない。

---

## talk11枝の暫定案: Counterpoint + Living Decisions 縦切り

### 会議前

- 参加者 **3人**
- 私的資料 **各1**
- 問い **1**
- 選択肢 **3**

### 会議中

- 明示主張 **1**
- 推定前提 **1**（確認フロー付き）
- 私的反証の共有承認
- Commit **1**

### 会議後（Living）

- 外部イベント **1**
- 前提失効
- 状態 → `REVIEW REQUIRED`
- アクション保留
- 再検討タスク生成

### 体験弧（削らない）

```
準備 → 私的支援 → 共有 → 決定 → 実行/監視 → reopen
```

---

## 縮小時の原則

> 前回の縮小案は、実装範囲としては妥当だが、体験としては縮めすぎ。（talk8枝内。同文はtalk11枝にも現れる）

> 削るべきなのは会議ライフサイクルではなく、扱う会議の種類と推論対象。

| 狭くする | 長く保つ |
|----------|----------|
| オントロジー（会議タイプ・推論対象） | 体験弧（前・中・後） |
| 参加者・選択肢・介入の数 | Private→Shared→Commit の権限フロー |

---

## やる / やらない

### やる

- 意思決定型会議1本の縦切り
- Private / Shared / Commitment の分離
- 発言事実とAI推定の分離
- 明示前提付き Decision Object
- monitor adapter **1つ**
- Build-time Codex + ランタイム GPT-5.6
- 3分で成否が画面で分かるデモ

### やらない（MVP）

- AI自動発言・AI最終決定
- 感情分析・完全自動diarize
- 全会議タイプ対応
- 自律交渉
- 組織全体SSoT
- 広域課題探索 / 1000件収集
- 暗黙知の自動発見（当事者なし）
- Platform化・マルチテナント本番
- Runtime Codex必須化

---

## 別枝のMVP候補（前後関係は不明）

### CommitLayer MVP（現形はtalk3およびtalk4/talk11共有幹で否定）

過去案件断片 → 暗黙ルール推定 → 未公開案件で失敗予測 → Preflight → 反実仮想デモ

### Promise Compiler MVP（talk3枝の代替案）

約束3つ埋め込みデモアプリ → 検査生成 → 失敗 → Codex修正 → 再検査

証明するのは一件: 自然言語の約束 → 実行可能検査 → 不一致発見 → 検証済み修正

部門: Developer Tools 寄り

### 過度縮小案（批判され修正）

「未確認前提と資料の結びつけ」だけ → 賢い会議プラグイン化 → **却下**

---

## Living Decisionsを選ぶ場合のデモ一本

```
Private context
→ Permissioned evidence
→ Shared decision
→ Explicit assumptions
→ External event
→ Assumption invalidated
→ Decision reopened
```

動画構成の枠: [02-submission-checklist.md](./02-submission-checklist.md)

---

## 関連

- 製品定義: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)
- 状態モデル: [11-state-model.md](./11-state-model.md)
- 棄却: [21-rejected-deferred.md](./21-rejected-deferred.md)
