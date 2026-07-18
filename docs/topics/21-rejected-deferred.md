# 21 — 棄却・延期一覧（ハッカソン）

出典: `talk2`, `talk3`, `talk8`, `talk9`, `talk11` ほか  
「切る」判断の核: *構想ではなく、外部から検証できない形の主張を諦める*

> **時系列制約:** 「KILL」「延期」「候補」は、原則として記載した枝の中での判断。別枝の判断を時間的に上書きしたとは限らない。

---

## 複数枝で比較的強く否定されたもの

| 項目 | 扱い | 理由（対話） |
|------|------|-------------|
| 構想A そのまま（広域探索エンジン） | KILL | 完成確率低、正しさ検証困難、3分動画弱い |
| 構想B / CommitLayer 現形 | KILL | 業務履歴・正式事実・当事者承認・効果観測が揃わない。合成デモは能力実証が弱い |
| 1000件課題探索を中核にする | KILL | talk3枝で明示除外 |
| 「非SSoT解消」「属人化解消」フレーミング | KILL | 抽象で「情報が整理された」に見える |
| 永久組織SSoT統合 | KILL | 非現実；部門ごとに正当情報源が違う |
| Meeting Lifecycle OS 全体実装 | 延期 | 前中後フル＋全クライアント＋完全グラフ＋組織学習は同時実装で破綻 |
| DecisionGraph を製品名に | 降格 | ダサい/わかりづらい；内部技術名へ |
| Quorum / Resolve / Convene / Pact / Accord | 避ける | 既存製品衝突 |
| AI最終決定・自動発言・感情分析・完全自動diarize | MVP外 | 設計方針・工数 |
| 縮小しすぎた「前提と資料の結びつけだけ」 | KILL | 賢い会議プラグイン化（talk8） |
| 構想Cの Work 再現可能部分を自前実装 | KILL | 作る必要なし（talk9） |
| Runtime Codex 必須化 | 非必須 | Build-time Codexが必須ライン |
| 複数部門への同一プロジェクト重複応募 | 不可 | FAQ |

---

## 特定枝で脇に置かれた／並存するもの

| 方向 | ステータス | 出典 |
|------|------------|------|
| Promise Compiler | talk3枝の代替候補。全体で第二候補とは確定しない | talk3/4/11 |
| n=1 Software | 見送り（チェックリスト生成に劣化しやすい） | talk11 |
| 汎用Agent Supervisor | 見送り（抽象度高・競争激） | talk11 |
| 前提監視単体 | Counterpoint統合へ | talk11 |
| Executable Falsifier | 代替候補（完成しやすい安全案） | talk11 |
| 誤概念診断＋AI生徒 | 代替候補（勝率では強いEducation寄り） | talk11 |
| repo縦型実験 / 顧客導入Preflight | 手法資産としてDEFER | talk2 |
| 文明論を動画の主メッセージに | KILL（プレゼン） | talk4 |
| 収奪機会探索エンジン | KILL（倫理） | talk4 |
| 外部性捨てた即物最適化ツール | KILL推奨 | talk4 |

---

## talk11枝でまだ閉じていない選択

talk11枝の終端付近でユーザーは Living Decisions（1）寄りだが、次も残っている:

1. Counterpoint + Living Decisions
2. 誤概念診断 + AI生徒（Education寄り・勝率）
3. Executable Falsifier（安全案）

これは全会話の「最終発話」ではなく、talk11枝内の暫定判断である。実時間上ほかの枝より後であることも証明できない。

最終コミット前に閉じるべき未解決は [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md) の末尾参照。

---

## 切る判断の引用

> 構想A・Bを現在の形のままハッカソンへ出すのは、一度切るべき。（talk3、およびtalk4/talk11共有幹）

> 諦めるべきなのは構想ではなく、外部から検証できない形の主張。（同上）

---

## 関連

- アイデア詳細: [20-ideas-archive.md](./20-ideas-archive.md)
- 進化系譜: [10-product-evolution.md](./10-product-evolution.md)
- talk11枝の暫定MVP: [13-mvp-scope.md](./13-mvp-scope.md)
