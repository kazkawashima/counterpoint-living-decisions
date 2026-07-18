# 11 — 会議状態モデル

出典: 主に `talk6.md`, `talk7.md`（v0.1 / v0.2.0）、補強 `talk8.md`  
原文の詳細仕様・JSON Schema 断片は `talk7.md` を正本とする。本ファイルは実装参照用の圧縮版。

> **構造上確定:** talk6→talk7 は接続しており、この枝の中で状態モデルが具体化される。  
> **横断的統合:** Counterpoint / Living Decisions は別枝（talk8/talk9/talk11）の概念であり、talk7仕様から時間的に発展したとは証明できない。両者を接続する場合は、新しい設計判断として記録する。

---

## なぜこれがカーネルか

> 今お前がやるべきは派手なUIじゃなくて、**会議状態モデルを最小構成で定義しきること**。ここ逃げたら全部ふわっとした議事録ツールで終わる。（talk6）

中心にあるのは音声でもエージェントでもUIでもなく:

> 誰が、何について、どのような主張をし、何を前提とし、どの根拠を持ち、どこで他者と一致・対立し、何が未解決で、何を決定し、次に誰が何をするのか。

---

## 五層モデル

\[
S_t = (L_t, K_t, P_t, O_t, V_t)
\]

| 層 | 名前 | 役割 |
|----|------|------|
| L | Ledger | 証拠台帳・追記専用 |
| K | Deliberation Graph | 意味・議論グラフ |
| P | Process State | フェーズ・決定準備度等 |
| O | Outcome State | 決定・異論・アクション |
| V | Views | shared / participant_private / moderator |

実装メモ（対話）: 初期はグラフDB不要。**イベント＋ノード＋エッジ＋Reducer**で十分。

---

## 五原則（外してはいけない）

1. **発言事実とAI推定の分離**（`origin`, `confirmation_status` 等）
2. **共有 / 私的の分離**
3. **支持者数と案の質の分離**
4. **合意目的化の拒否**（合意量最大化ではない）
5. **決定まで追跡可能性**

---

## 核心の分離

```
Utterance ≠ Proposition ≠ Stance ≠ Premise ≠ Evidence
```

推測を「本人が言った事実」にしない。同一命題の複製ではなく、同一命題への**複数 Stance** 接続。

---

## 主要エンティティ（talk7）

| エンティティ | 意味 |
|--------------|------|
| MeetingContract | この会議が何のために存在するか |
| Participant | 参加者、役割、権限、専門領域 |
| SourceArtifact | PDF、スライド、表、URL、音声、メモなど |
| Utterance | 実際の発言イベント |
| Proposition | 発言や資料から抽出された命題 |
| Question | 回答すべき問い |
| Claim | 真偽や妥当性を議論する主張 |
| Premise | 主張が暗黙または明示的に依存する前提 |
| Definition | 用語の意味や適用範囲 |
| Evidence | 主張を支持・反証する根拠 |
| Option | 選択肢、施策、提案 |
| Criterion | 選択肢を評価する基準 |
| Constraint | 予算、時間、法務、技術などの制約 |
| Risk | 選択肢に関連する不確実性や損失可能性 |
| Evaluation | 選択肢を基準に照らして評価した結果 |
| Decision | 採用された結論 |
| Dissent | 決定後も残る反対意見 |
| Action | 決定を実行する作業 |
| Intervention | AIまたはモデレーターが行う介入候補 |

関係例: `supports` / `contradicts` / `assumes` / `answers` / `depends_on` / `satisfies` / `violates` / `implements`

---

## 前進条件

発言量ではなく、構造的・認識上・選択上・実行上の前進（progressベクトル）。

talk6宿題: 「この状態が更新されれば会議は前進したと言える」条件を3つ。talk7が代理定義。ユーザー確定回答はエクスポート内に未確認。

---

## 会議ライフサイクル（前・中・後）

| フェーズ | 内容 |
|----------|------|
| 前 | 会議契約・私的準備 |
| 中 | 抽出 / 共有更新 / 介入候補 |
| 後 | 決定・アクション・後続継承・実行結果のフィードバック |

縮小時の原則（`talk8`）:

> 削るべきなのは会議ライフサイクルではなく、**扱う会議の種類と推論対象**。

### 最小対象（対話）

- 3–8人、30–60分、意思決定型
- 各端末＋共有画面1

### 最初に扱わない

AI自動発言 / AI最終決定 / 感情分析 / 完全自動diarize / 全会議タイプ / 自律交渉

---

## Living Decisions への拡張点

会議グラフ仕様（本ファイル）と Decision lifecycle（`DRAFT → … → MONITORING → AT RISK → REVIEW REQUIRED`）の**単一正本マージは対話内で未完了**。

実装時は:

1. talk7 のエンティティを基底にする
2. Decision Object に依存前提・監視アダプタ・バージョン履歴を載せる
3. Counterpoint の三状態（Private / Shared / Commitment）をビュー層として載せる

詳細: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)

---

## モデル分担（構想C MVP）

| 役割 | 担当 |
|------|------|
| Realtime | 私的ライブ支援 |
| GPT-5.6 | 深い状態統合 |
| diarize | 補助 |
| 通常コード | 正準状態・ACL・イベント・確定 |

話者同定はモデル依存を避け、**参加者クライアントID付与**を主とする。

AI介入は初期は画面提示・モデレーターサジェストに限定（自動発言しない）。

---

## 関連

- 進化: [10-product-evolution.md](./10-product-evolution.md)
- 原文: `../talk7.md`
