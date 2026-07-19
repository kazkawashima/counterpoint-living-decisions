# 10 — プロダクト構想の枝別系譜

出典: `talk1`〜`talk11`（特に `talk2`, `talk3`, `talk7`, `talk8`, `talk11`）  
対話にない内容は含めない。

> **時系列制約:** 以下は実時間順ではない。各枝内の論理展開と、複数枝を後から比較するための概念関係を分けて記載する。`talkN` の番号、枝深度、エクスポート時刻から枝間の前後は決めない。

---

## 構造上確認できる枝マップ

```
独立根（全体で7本）
├─ talk1: 探索ファネル / Codex・GPT分担
├─ talk2: Just-in-Time SSoT / CommitLayer再構成
├─ talk3 ─┬─ CommitLayer → A/B現形を切る → Promise Compiler
│         └─ talk8: 会議系MVP → Counterpoint
├─ talk4 ─┬─ 部門・Promise系の終端
│         └─ talk11: 構想C → Counterpoint → Living Decisions → 候補比較
├─ talk5: 部門競争・IP
├─ talk6 → talk7: 会議状態モデル / Meeting Lifecycle OS v0.2
└─ talk10: Devpost申込

talk9: talk4/talk11経路中と同文の発話を接続点として
       Counterpoint / ChatGPT Work境界を議論（接続は推定）
```

`talk3` と `talk8` は先頭1発話、`talk4` と `talk11` は52発話を共有する。それ以外の概念接続は、原則として**横断的統合**である。

---

## ファイル対応（順序ではなく出所）

| ファイル | 製品設計上の役割 | 構造上の位置 |
|----------|------------------|--------------|
| talk1 | 構想A探索パイプラインの初期 | 独立根 |
| talk2 | Just-in-Time SSoT / コミット機構への組み直し | 独立根。talk1との順序は不明 |
| talk3 | CommitLayer製品化、A/B比較、Promise Compiler | talk8との分岐元 |
| talk4 | A/B具体化・MVP・部門、Promise詳細 | talk11と52発話共有 |
| talk5 | 部門競争分析 | 独立根 |
| talk6 | 状態モデル着想の音声対話原点 | talk7の親経路 |
| talk7 | 状態モデル v0.1 + spec v0.2.0 | talk6末尾に接続 |
| talk8 | 会議系縮小MVP、Counterpoint命名 | talk3と先頭1発話共有後に分岐 |
| talk9 | Counterpoint vs ChatGPT Work境界 | 中間発話への推定接続 |
| talk10 | Devpost申込 | 独立根 |
| talk11 | 構想C、Counterpoint、Living Decisions、候補比較 | talk4共有幹からの兄弟枝 |

---

## 構想A — Bottleneck Explorer

**定義:** 公開された行動痕跡を広く観測し、「誰が何を動かそうとしているか／どの状態遷移が阻害されているか／誰へ費用が外部化されているか」を発見するエージェント層。

**単位:** 企業ではなく `主体 × 対象 × 現在状態 × 目的状態`

**枝内結論:** talk3、およびtalk4/talk11共有幹では、現形のままのハッカソン提出を切る判断がある。ビジョン（5%）として残す比率はtalk11枝内の提案であり、全枝共通の確定値ではない。

**詳細アーカイブ:** [20-ideas-archive.md](./20-ideas-archive.md)

---

## Just-in-Time SSoT / コミット機構

**定義:** 全組織を永久SSoTに統合せず、**あるトランザクションを確定する瞬間だけ、その範囲に必要な正準状態を作る**。

製品は知識管理ではなく「決定・実行直前のコミット機構」。

「非SSoTと属人化を解消するAI」という見せ方はハッカソンで弱い（症状と原因の取り違え）。

---

## 構想B / CommitLayer

**定義:** 分散した業務履歴から人間が暗黙に実行している成立条件を発見し、証拠付きプロトコルとして提示し、承認後に **Preflight** へ変換する。

> その担当者自身が、組織に欠けているソフトウェアになっている。

**枝内結論:** 現形のまま提出する案は、talk3およびtalk4/talk11共有幹で否定される（業務履歴・正式事実・当事者承認・効果観測が揃わない）。

**横断的統合:** 残核は Promise Compiler と会議系の双方に見いだせる。ただし、Promise Compilerから構想Cへ時間的に移行したことは証明できない。

---

## Promise Compiler（退避）

LP/README/仕様の**明示された製品約束**を抽出し、実プロダクトに対する実行可能検査へ変換。不一致を証拠提示し、承認後Codexが修正し再検査。

部門感触: Developer Tools 寄り。**talk3枝の代替提出候補**。会議系より先か後か、また「第二候補」に降格した時点は枝間では確定できない。

---

## 構想C — 会議ライフサイクル / Decision State（talk9/talk11の事後ラベル）

会議を「複数人による分散した思考・評価・意思決定プロセス」として扱い、**参加者ごとの私的思考支援と会議全体の共有議論状態を接続**する。

ハッカソン向けには:

> 一つの意思決定会議を、会話から監査可能な Decision State へ変換する製品

**talk11枝内のパッケージング案:** C 75% / B 20% / A 5%。全枝横断の合意ではない。

**概念上の包含関係:** Meeting Lifecycle OS / DecisionGraph → Counterpoint → Living Decisions。これは複数枝を横断した編集上の整理であり、実時間順ではない。Meeting Lifecycle OSの詳細仕様は独立したtalk6→talk7枝にある。

状態モデル詳細: [11-state-model.md](./11-state-model.md)

---

## Counterpoint → Living Decisions

| | Counterpoint | Living Decisions |
|--|--------------|------------------|
| 重心 | 会議 → Commitment | **意思決定オブジェクト** |
| 証明 | 正しく生む | 時間の中で生かす |
| カテゴリ | commitment layer | Decision Runtime |

talk11枝の暫定候補の詳細: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)

---

## 横断的な概念マップ（非時系列）

```
構想A (発見する Commitment; talk1/2/3/4/11の関連議論)
   └─「何を遷移させるべきか」
構想B / CommitLayer (条件の Commitment) ──Just-in-Time SSoT──┐
   └─「遷移を成立させる条件」                                │
Promise Compiler ──明示約束版B（talk3枝の代替案）              │
構想C / Meeting State Model ──別枝にある観測可能な小世界──────┘
   └─ Counterpoint (私的↔共有↔Commit のプロトコル)
         └─ Living Decisions / Decision Runtime（talk11枝のみ）
               └─ 決定オブジェクトが前提破壊を検知して reopen
```

このマップは概念の再利用・包含を示す。矢印を会話日時や決定の上書き順として読まない。

---

## クリティカル引用

1. 「必要なのは永久的な単一真実ではなく…Just-in-Time SSoT」（talk2）
2. 「構想A・Bを現在の形のままハッカソンへ出すのは、一度切るべき」（talk3/4/11）
3. 「諦めるべきなのは構想ではなく、外部から検証できない形の主張」（talk3/4/11）
4. 「会議はインターフェースであって、製品カテゴリーではない。」（talk8）
5. 「構想Cの限定版が明確に最有力」（talk11のA/B/C比較文脈）
6. 「Living Decisionsは…重心を『会議』から『意思決定』へ移す再定義」（talk11枝）

## 現在の決定と未確定事項

- **2026-07-19の実装判断:** MVPは Counterpoint + Living Decisions を
  **Work & Productivity** 部門へ提出する。オフィス／家庭／チーム常駐型
  エージェントへの将来進化は、このMVPの部門判断を変更しない。
- Meeting State Model v0.2 と Living Decision state machine の統合詳細は
  実装仕様で管理する。

---

## 関連

- 状態モデル: [11-state-model.md](./11-state-model.md)
- talk11枝由来の選択済みMVP: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)
- MVP: [13-mvp-scope.md](./13-mvp-scope.md)
- 棄却一覧: [21-rejected-deferred.md](./21-rejected-deferred.md)
