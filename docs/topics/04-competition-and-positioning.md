# 04 — 競争分析・ポジショニング・命名

出典: `talk5.md`, `talk8.md`, `talk9.md`, `talk11.md`, `talk2.md`

> **重要:** 部門別提出数は対話時点で未公開。以下のシェア・競争率は talk5枝の推定であり、事実ではない。talk11枝では「Educationが空いていることも仮説」と明示的に留保されている。

---

## 部門別競争（talk5枝の推定・意思決定根拠には再検証必須）

登録者数は、talk5で約2.9万人、talk11の別発話で約3.2万人と記録されている。これは発話時点の観測値であり、どちらを現在値とも断定しない。ギャラリー未公開のため部門別提出数は未知。

| 部門 | talk5枝の推定シェア | 「最少」の推定 | 推定理由・弱点 | 確度 |
|------|--------------------|----------------|---------------|------|
| Work & Productivity | 30–38% | ~5% | 汎用業務AIが集中しやすい | 低。提出数未確認 |
| Apps for Your Life | 25–33% | ~10% | 参入しやすく応募が増えやすい | 低。提出数未確認 |
| Developer Tools | 18–25% | 次点過疎~25% | 応募数より上位層の技術密度が高い可能性 | 低。提出数未確認 |
| Education | 12–20% | 最少~60% | 対象理解が必要で参入が減るという仮説 | **低。talk11枝で「空いている」は未確認と留保** |

- 賞金が全部門同額なら過疎部門を選ぶ誘因はある、という推論。ただし過疎かどうか自体が未確認
- talk5枝の戦略判断は「単純に過疎部門へ行く発想は粗い」。人数差より問題理解・完成度・デモ差を重視

### 構想→部門マッピング案 [戦略・候補依存]

| 構想 | 最寄り部門 |
|------|-----------|
| Counterpoint / Living Decisions / 会議意思決定 | Work & Productivity が自然という案 |
| Promise Compiler（約束→受入テスト） | **Developer Tools** |
| 誤概念診断 + AI生徒 | **Education** |
| 構想A広域探索 | Work（ただし提出KILL） |
| CommitLayer | Work（提出KILL） |

**判定軸:** 主利用者・主問題・最頻ユースケース（入力がLPだからWork、ではない）。

---

## 勝ち筋の枠組み（`talk11`）

> **自明な痛み × 非自明な機構**

条件:

1. リリースノートから直線導出不可
2. 最初奇妙→説明で必然
3. 3分で説明可
4. 専門家でなくとも画面で成否判定可

多数の参加者が同じ能力表を見る以上「multi-agentで○○」は重複しやすい、というtalk11枝の推論。約3.2万人という値は会話時点の観測であり固定値ではない。

タイブレークは Tech → **非自明×粗いデモ < 十分非自明×完成体験**。

---

## 命名・メッセージ階層

原則: 1名前＋1キャッチで全員に刺そうとすると薄くなる → **メッセージ階層**。

| 層 | 役割 | Counterpoint案（対話） |
|----|------|------------------------|
| Product name | 記憶 | Counterpoint |
| Category descriptor | 何の製品か | The commitment layer for agent-native teams |
| Core tagline | 世界観 | Independent minds. Shared commitment. |
| Judge hook | OpenAI向け | When everyone has an agent, the room needs a protocol. |
| Competitive contrast | 差分 | Meeting AI records the room. Counterpoint changes what the room can decide. |
| Living Decisions hook | 時間軸 | Decisions should know when they are no longer true. |

避ける衝突名例: Quorum, Resolve, Convene, Pact, Accord。

`Decision OS` / `Meeting OS` より **`commitment layer` / `Decision Runtime`** の方が MVP 実態に合う。

> 会議はインターフェースであって、製品カテゴリーではない。（`talk8`）

---

## Living Decisions を選ぶ場合のフレーミング（talk11枝・未確定）

> **Counterpoint — Living Decisions for Agent-Native Teams**

OpenAI向け命題:

> AIは個人の作業能力を拡張した。しかし、集団の判断能力はまだ拡張していない。

詳細: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)

---

## 関連

- ルール: [01-hackathon-rules.md](./01-hackathon-rules.md)
- 棄却案: [21-rejected-deferred.md](./21-rejected-deferred.md)
