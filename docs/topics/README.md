# basedtalks → トピック別リファレンス

OpenAI Build Week 提出と新世代システム構築のため、`talk1.md`〜`talk11.md` の対話を**テーマ横断で再編成**した索引。

生ログは会話ツリー単位。ここは開発・出品作業で「今この論点だけ読みたい」ための参照面。

## 最重要: 時系列と結論の扱い

このエクスポートから確定できるのは、**各ファイル内の発話順・本文一致による共有区間・分岐構造**までである。次は確定できない。

- `talk1.md`〜`talk11.md` 相互の実時間順
- 兄弟枝のどちらが先に会話されたか
- `枝分かれ` の深さと会話日時の対応
- `exportedAt` と会話実施日時の対応

したがって、ファイル番号順や枝の深さを「思想の進化順」として扱わない。本ディレクトリでは次のラベルを用いる。

| ラベル | 意味 |
|--------|------|
| **構造上確定** | 同一ファイル内順序、共有prefix、明示された分岐 |
| **枝内結論** | 特定の会話枝では成立するが、他枝を上書きしない |
| **横断的統合** | 複数枝の概念を編集上接続したもの。歴史的時系列ではない |
| **未確定** | 候補・判断が閉じていない |
| **推測** | 対話からの解釈。理由と反証可能性を併記する |
| **会話時点** | 登録者数・配布状況など、発話時点で変化し得る値 |
| **公式再確認要** | Devpost原文を現在時点で再確認すべき規約情報 |

構造監査で確認できた主な関係:

- `talk3 ↔ talk8`: 先頭1発話を共有して分岐
- `talk4 ↔ talk11`: 52発話を共有し、その後分岐
- `talk6 → talk7`: talk6末尾「了解。」を接続点とする
- その他は独立根またはスクリプトによる推定接続であり、全体には7本のトップレベル木がある

## 使い方

英語版は [`en/README.md`](./en/README.md) から参照できます。日本語版が
このエクスポートの原文で、英語版は提出・開発時の参照用翻訳です。

| 局面 | 読む順 |
|------|--------|
| 提出準備を進める | `01` → `02` → `03` → `05` |
| 何を作るか再確認 | `10` → `12` → `13` |
| 状態モデル実装 | `11` → `12` |
| 捨てた案・長期ビジョン | `20` → `21` |
| 部門・命名・審査員向け物語 | `04` |

## ファイル一覧

### ハッカソン運営

| ファイル | 内容 |
|----------|------|
| [01-hackathon-rules.md](./01-hackathon-rules.md) | 概要・締切・部門・Codex/GPT-5.6・審査ステージ |
| [02-submission-checklist.md](./02-submission-checklist.md) | 提出物・動画・README・Session ID・Demo維持 |
| [03-ip-and-license.md](./03-ip-and-license.md) | 著作権・所有・Public/Private・Apache・baseline |
| [04-competition-and-positioning.md](./04-competition-and-positioning.md) | 部門競争・命名階層・Judge vs User |
| [05-risks-and-caveats.md](./05-risks-and-caveats.md) | 失格・減点・失敗モード |

### プロダクト（提出候補）

| ファイル | 内容 |
|----------|------|
| [10-product-evolution.md](./10-product-evolution.md) | 枝別の構想系譜と横断的な概念統合 |
| [11-state-model.md](./11-state-model.md) | 会議状態モデル・エンティティ・五原則・五層 |
| [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md) | talk11枝の暫定候補・差別化・デモ核 |
| [13-mvp-scope.md](./13-mvp-scope.md) | talk11枝の暫定MVPスコープ・やる/やらない |
| [14-implementation-requirements.md](./14-implementation-requirements.md) | 質疑で確定した新リポジトリの実装要件・構成・検証基準 |
| [15-submission-readiness-and-risk-controls.md](./15-submission-readiness-and-risk-controls.md) | 提出事故とプロダクト不安定要因のWhy/What/How |

### アイデアアーカイブ

| ファイル | 内容 |
|----------|------|
| [20-ideas-archive.md](./20-ideas-archive.md) | 探索パイプライン・JIT-SSoT・ボトルネック理論など |
| [21-rejected-deferred.md](./21-rejected-deferred.md) | 提出から切った／延期した案の一覧 |

## 生データとの関係

```
talk*.md                 … 各ファイル内のみ順序が確定した会話エクスポート
utterance-tree.json      … 発話ノードの重複統合ツリー（構造面）
topics/*.md              … テーマ面の参照用再編成（本ディレクトリ）
build_utterance_tree.py  … ツリー再生成スクリプト
```

`utterance-tree.json` の `attachedToParent` は、タイトルと先頭発話一致を使った**推定エッジ**を含む。ChatGPTが提供した親会話IDではない。

**優先順位:** 規約の最終判断は常に [openai.devpost.com](https://openai.devpost.com/) 原文。本ディレクトリは対話の抽出であり、ラベルが不足する箇所は確定情報として扱わない。

## talk11枝の暫定提出候補（全体では未確定）

> **Counterpoint — Living Decisions for Agent-Native Teams**

- 表面: 構想C限定版（会議 → 監査可能 Decision / Commitment）
- 時間軸: Living Decision（前提監視 → reopen）
- 内部言語: 構想B（Context → Commitment）
- 将来ビジョン: 構想A（短く）
- 詳細: [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md) / [13-mvp-scope.md](./13-mvp-scope.md)

これは `talk4.md` と共有する52発話の後に分岐した `talk11.md` 内で、ユーザーが暫定的に1案へ寄せた結果である。次の候補は閉じていない。

1. Counterpoint + Living Decisions
2. 誤概念診断 + AI生徒
3. Executable Falsifier

`talk11.md` は構造上長い枝の一つだが、**時間的に最新または全枝を上書きする正本とは証明できない**。
