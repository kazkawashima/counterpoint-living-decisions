# 12 — Counterpoint / Living Decisions（talk11枝の暫定候補）

出典: `talk8.md`, `talk9.md`, `talk11.md`  
進化の文脈: [10-product-evolution.md](./10-product-evolution.md)

> **結論の強さ:** Counterpoint は talk8/talk9/talk11 の関連枝に現れる。
> Living Decisions への再定義は talk11枝のみ。これは会話資料の由来に
> 関する限定であり、現在の実装判断では Counterpoint + Living Decisions
> をMVP提出本体として選択済みである。確定要件は `docs/specs/` を正本とする。

> **統合状態:** talk6→talk7枝の Meeting State Model v0.2 と、talk11枝の Living Decision state machine は未統合。以下のMVPは両者を統合した場合の**横断的設計案**である。

---

## 一文定義

**Counterpoint:** 各参加者に私的エージェントを与え、本人が選んだ Context だけを共有状態へ接続し、部屋の decision state をリアルタイム維持し、熟議を**監査可能な Commitment と実行可能なフォロースルー**へ変えるプロトコル製品。

**Living Decisions:** 決定を会議終了時の静的パケットで終わらせず、**依存前提を保持し、現実変化で再検討状態へ自ら遷移する Decision Object**として扱う。製品重心を「会議」から「意思決定」へ移す再定義。

> Counterpoint単体は、決定を正しく生む。Living Decisions版は、決定を時間の中で生かす。

---

## talk11枝の暫定パッケージ名

> **Counterpoint — Living Decisions for Agent-Native Teams**

| 層 | 内容 |
|----|------|
| 表面プロダクト | 構想C限定版（talk11枝内） |
| 時間軸拡張 | Living Decision（talk11枝内） |
| 内部設計言語 | 構想B（Context → Commitment）という横断的解釈 |
| 将来ビジョン | 構想Aを短く、というtalk11枝内提案 |
| MVP提出部門 | Work & Productivity（2026-07-19決定） |

---

## 中核フロー

```
Private context
→ Selective disclosure / Permissioned evidence
→ Shared decision state
→ Explicit assumptions
→ Commitment
→ External event (monitor)
→ Assumption invalidated
→ Decision reopened (REVIEW REQUIRED)
→ Actions held / revisit task
```

### 証明すること / しないこと

| する | しない |
|------|--------|
| 決定が出典・前提・権限・異論・実行/再検討条件を持つ | 「最終判断が絶対に正しい」 |
| 現実変化で再検討へ遷移する | 豪華議事録・会議時間削減だけの効率ツール |
| | 「OS全部入り」 |

---

## 差別化言語

| 対比 | 文言 |
|------|------|
| vs Meeting AI | Meeting AI records the room. Counterpoint changes what the room can decide. |
| vs 個人エージェント | When everyone has an agent, the room needs a protocol. |
| vs ChatGPT Work | 記録・検索・要約・タスクは近似可能。残る中核は **Permission & Commitment Broker**（非対称Private Contextの権限調停） |
| Living hook | Decisions should know when they are no longer true. |
| Tagline | Independent minds. Shared commitment. |

カテゴリ表現: `commitment layer` / `Decision Runtime` / `Living Decision System`  
`OS` 呼称は避ける（MVPが証明するのは変換層）。

---

## Living Decision 状態例

```
DRAFT → DECISION READY → COMMITTED → MONITORING
  → AT RISK → REVIEW REQUIRED → …
```

- 上書きせずバージョン履歴（v1/v2/v3）と証拠・影響アクションを残す
- ハッカソンは「一件の決定が後日一イベントで再検討へ移る完全縦切り」
- Platform化はしない
- 実装増分の概算（対話）: Counterpoint単体100に対し Living 版 140–160

---

## ChatGPT Work 境界（`talk9`）

| Workで近似可能 | 自前が必要なプリミティブ |
|----------------|--------------------------|
| 会議記録・検索・要約・タスク | 複数独立所有者の権限調停 Broker |
| | 私的存在照会・確認済み分離 |
| | 再検討条件付き Commitment |

アーキ案: 個人ContextをWork連携に寄せ、自前はBrokerに集中——実装境界は未決定。

---

## talk11枝内の評価上の位置

思想・OpenAI物語・長期価値という評価軸で **Counterpoint + Living Decisions が一位（8.5）**。

同じtalk11枝内でも、デモ強度・完成確率では「誤概念診断＋AI生徒」が
上回り得て、締切リスクでは Executable Falsifier が安全案として記録された。
枝内の当時の表現は「1か2か」だったが、その後2026-07-19の実装判断で
Living Decisions をMVP本体として選択した。

したがって「総合一位」を全評価軸または全会話枝の結論へ拡張しない。

代替候補の扱い: [21-rejected-deferred.md](./21-rejected-deferred.md)

---

## 現在の決定と残るゲート

1. MVP提出本体は Counterpoint + Living Decisions。
2. 3分動画では time-jump と注入イベントを**明示的なデモ用ストーリー**
   と表示する。最終編集構成は別途確定する。
3. Counterpoint 商標・ドメイン確認。
4. MVP提出部門は Work & Productivity。将来のオフィス／家庭／チーム
   常駐型エージェントへの進化は別スコープ。
5. 監視アダプタの種類（MVPは1つまで）。
6. 状態モデル v0.2.0 と Living Decision state machine の統合スキーマ。

---

## 関連

- 状態モデル: [11-state-model.md](./11-state-model.md)
- MVPスコープ: [13-mvp-scope.md](./13-mvp-scope.md)
- 命名: [04-competition-and-positioning.md](./04-competition-and-positioning.md)
