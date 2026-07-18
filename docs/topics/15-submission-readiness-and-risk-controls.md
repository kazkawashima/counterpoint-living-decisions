# 15 — 提出レディネスとプロダクト安定化

作成日: 2026-07-19  
対象: Counterpoint — Living Decisions  
前提仕様: [14-implementation-requirements.md](./14-implementation-requirements.md)

## 1. 目的

本書は、OpenAI Build Weekへ提出する一本の実動シナリオを守るため、提出事故とプロダクト不安定要因を `Why / What / How` で固定する。

実装順序を網羅する計画書ではない。実装中に機能追加と安定化が競合した場合の判断基準である。

最上位原則:

> Flagshipシナリオが最後まで動作することを、追加機能、汎用化、補助デモ、視覚的装飾より常に優先する。

## 2. 審査用アクセスとAPI費用

### Why

公式規約は、審査期間終了まで無料かつ制限なしで動作プロジェクトへアクセスできることを求める。審査員へOpenAI APIキーの準備を要求するBYOK専用デモは、費用負担または利用制限と解釈される危険がある。

一方、審査credentialが公開SubmissionやGalleryへ露出した場合、第三者によるAPI費用濫用が起こり得る。Devpostの一般的なTesting GuideはSubmission formの`Testing Instructions`へcredentialを記載する運用を案内しているが、このハッカソン固有フォームの一般公開範囲は最終画面で確認する必要がある。

### What

- 一般利用: BYOK
- 審査利用: server-funded judge mode
- 審査用標準APIキー: Cloudflare Worker Secret
- 審査用credential: 公開README、動画、リポジトリ、公開説明欄へ記載しない
- judge mode: 審査専用ユーザーだけに許可

### How

1. Cloudflareへ`OPENAI_API_KEY_JUDGE`をSecretとして登録する。
2. 通常の`vars`、`.env`、`.dev.vars`、GitHub Actions logへproduction keyを書かない。
3. judge userの認証後だけ、WorkerがSecretを使ってOpenAI呼び出しまたはRealtime短期secret発行を行う。
4. standard keyをブラウザ、Durable Object state、D1、R2、監査イベントへ複製しない。
5. アカウント、IP、会議数、同時接続、Realtime分数、token、日次総額へhard limitを置く。
6. Devpostの`Testing Instructions`にcredentialを入力した後、提出プレビューとログアウト状態で一般ユーザーから見えないことを確認する。
7. 非公開性を確認できない場合は、審査共有済みprivate repositoryまたは運営指定の非公開経路へ案内を置く。
8. credential漏洩を前提に、利用上限だけで費用上限を保証する。
9. 審査期間終了後にcredentialを失効し、Secretをrotateまたは削除する。

## 3. 一本のシナリオを最優先する

### Why

評価対象は機能数ではなく、動作し、一貫し、動画と説明どおりに再現できるプロダクトである。複数の未完成シナリオは、Design評価と再現性の両方を下げる。

### What

Flagship「グローバルAI製品展開」だけを提出必達とする。

必須の縦切り:

```text
Login
→ Meeting
→ Private context
→ Speak to room / Speak privately
→ Explicit evidence disclosure
→ Shared decision state
→ Commitment
→ External event
→ AT_RISK
→ REVIEW_REQUIRED
```

### How

- 上記が新規環境で完走するまで、QuickstartとMeta demoを実装しない。
- 補助シナリオはseed fixtureまたは将来候補の文書に留めてよい。
- 全エンティティを実装せず、Flagshipで実際に表示・遷移する型だけを実装する。
- Docker ComposeとCloudflareの差異がFlagshipを壊す場合、提出本番であるCloudflareの動作を優先する。
- 動画、README、テスト手順は同じFlagshipだけを説明する。

## 4. 音声トポロジー

### Why

本MVPは人間向け音声配送を行わない。そのため遠隔参加者は本アプリだけでは互いの声を聞けない。

同室で複数端末のマイクを同時に開くと、一つの発話を複数端末が取得し、重複transcript、誤ったspeaker identity、echoが発生する。複数タブでも同時マイク利用は不安定である。

### What

- shared発話はpush-to-talkを必須とする。
- 同時に一人だけをactive shared speakerとする。
- private発話はヘッドセット利用を標準とする。
- 音声通話機能ではなく、会議状態入力機能として説明する。
- 音声が失敗しても同じイベントを生成できるテキスト入力を常設する。

### How

1. マイクは初期状態をOFFにする。
2. `Speak to room`と`Speak privately`を色だけに依存しない明示ラベルで表示する。
3. 発話開始時に選択経路を固定し、発話中の自動切替を禁止する。
4. shared floorをserver側leaseで排他し、二重発話時は後続を待機させる。
5. client eventに`participantId`、`utteranceId`、`channel`、`capturedAt`を付ける。
6. server側でidempotencyを保証し、遅延・重複eventを吸収する。
7. 一人デモでは同時に一タブだけマイクを有効化する。
8. 本番デモ前に使用端末、ブラウザ、ヘッドセット、マイク権限を固定する。

## 5. Realtime接続数・費用・障害

### Why

3〜8人がshared/privateの二sessionを保持すると、最大16 Realtime sessionになり得る。rate limit、接続切断、ブラウザ制約、費用はアカウントtierと実行時間に依存する。

shared発話のたびに全private agentを生成実行すると、利用量が参加人数に比例して増加する。

### What

- shared/privateの論理分離は維持する。
- 接続は必要時だけ確立し、常時16 sessionを維持しない。
- shared event受信とprivate agent推論実行を分離する。
- judge modeは同時接続時間と生成回数を制限する。

### How

- push-to-talk開始前に対象sessionを準備し、無操作sessionを閉じる。
- private agentはshared eventを状態として受け取るだけにし、本人操作または明確なtrigger時だけ生成する。
- reconnectは指数backoffと上限回数を持つ。
- Realtime失敗時はテキスト入力へ降格する。
- 使用model、接続秒数、token、エラー率をsecretを含めず記録する。
- Flagshipで必要な3人構成を基準に負荷試験し、8人対応は上限値として扱う。

## 6. AI推定と人間の確定境界

### Why

AIが前提失効を検出して直接`REVIEW_REQUIRED`へ遷移すると、「AI推定を人間の事実にしない」「AIが最終決定しない」という中核原則と矛盾する。

### What

- GPT-5.6の検出結果は`AT_RISK`候補とする。
- `REVIEW_REQUIRED`への確定はファシリテーター操作とする。
- AI出力と人間確認を別eventとして保存する。

### How

```text
ExternalEventReceived
→ AssumptionInvalidationSuggested
→ DecisionMarkedAtRisk
→ FacilitatorReviewed
→ DecisionReviewRequired
```

- AI eventへmodel、prompt version、input references、confidence、reasonを記録する。
- ファシリテーターには失効対象、根拠、影響Actionを表示する。
- 拒否した場合も理由を監査履歴へ残す。
- デモボタンは外部イベントを注入するだけにし、人間確認を自動化しない。

## 7. プロダクト主張の境界

### Why

一つの演出済みデモから「意思決定が正しくなった」「高度な意思決定能力を証明した」とは検証できない。過剰主張はPotential ImpactとQuality of the Ideaの信用を落とす。

### What

証明する主張:

- private情報が権限付きで共有される。
- 発言、推定、確認済み情報が分離される。
- Decisionが根拠、前提、異論、Actionを持つ。
- 現実変化でDecisionが再検討可能になる。

証明しない主張:

- 最終判断が常に正しい。
- 組織の暗黙知を完全に発見する。
- AIが人間より優れた経営判断を行う。

### How

- README、動画、Devpost説明で同じ主張境界を使う。
- 成果をaccuracyではなくtraceability、permission、responsivenessとして見せる。
- UIでは「AI inferred」「human confirmed」を常に区別する。

## 8. Private contextとprompt injection

### Why

privateファイルまたはURLには、モデルへ情報開示を指示するprompt injectionが含まれ得る。private agentがshared stateへ直接書けると、本人承認を迂回できる。

### What

- private agentにshared stateへの直接書き込み権限を与えない。
- 共有はserver側の明示的な承認commandだけで行う。
- 本人へ実際に共有されるpayload全体をpreviewする。

### How

1. 外部資料をinstructionではなくuntrusted dataとして囲う。
2. private検索結果をshared model contextへ自動挿入しない。
3. 共有候補は引用、出典、filename、metadataを含めてpreviewする。
4. 承認時にserverがowner、meeting、artifact、引用範囲を再検証する。
5. previewしたhashと実際に共有するpayloadのhashを一致させる。
6. agent toolは`proposeDisclosure`までとし、`publishDisclosure`を持たせない。

## 9. APIキー消失と復旧

### Why

BYOKをDurable Objectのメモリだけに置くと、退避または再起動によって安全に消える反面、会議中に突然利用不能になる。審査デモでの再入力要求は体験を壊す。

### What

- 一般BYOK: 消失時に再入力
- judge mode: Worker Secretから短期secretを再発行
- standard keyを会議状態へ永続化しない

### How

- key sourceを`facilitatorProvided`と`judgeManaged`で明示的に分ける。
- `judgeManaged`ではDOにstandard keyを渡さない。
- BYOK消失時は会議状態を維持したまま`API_KEY_REQUIRED`を返す。
- key再設定後に失敗commandを利用者操作で再試行できるようにする。

## 10. Meta demoの権利

### Why

実在応募者の紹介リール、ロゴ、デモ映像、READMEを取り込むと、第三者の著作権、商標、プライバシーに触れる可能性がある。提出動画には許諾のない第三者素材を含められない。

### What

Meta demoを作る場合は、架空応募、架空ロゴ、自作映像、自作評価資料だけを使う。

### How

- 実在企業・応募者・審査員の名前とロゴをfixtureへ入れない。
- 動画、音声、画像、文書の作成者とライセンスをmanifestへ記録する。
- Meta demoはFlagship完成後まで実装しない。

## 11. GPT-5.6とCodexの証拠

### Why

本プロジェクトの構想整理と会話資産の大半はGPT-5.6で作成され、実装もCodex中心で新規構築する方針である。ただし審査では、その事実をREADME、実際のruntime統合、Codex `/feedback` Session ID、commit履歴で同一ストーリーとして確認できる必要がある。

### What

- 新リポジトリは旧kernelコードをコピーせず、greenfieldで実装する。
- GPT-5.6をDecision state synthesisとassumption invalidationへ実質統合する。
- core implementationをprimary Codex threadへ集約する。
- 既存の構想資料と新規コードを区別する。

### How

- READMEにGPT-5.6の入力、出力、後処理、人間確認境界を記載する。
- runtime logへmodel IDとprompt versionをsecretなしで記録する。
- `/feedback` Session IDはcore functionalityの大半を構築したスレッドから取得する。
- Codexが加速した作業と、人間が行った製品・設計判断を分けて説明する。
- 提出commitをtagで固定する。

## 12. 新リポジトリへ移す文書

移行対象は、整理済みの`topics`文書だけとする。

含める:

- ハッカソン規約、提出、IP、競争、リスク
- プロダクト進化、状態モデル、Living Decisions、MVP、実装要件
- 本レディネス文書
- アイデアアーカイブと延期項目
- `topics/README.md`

含めない:

- `talk1.md`〜`talk11.md`の生ログ
- `utterance-tree.json`
- 会話再構築script
- 旧Meeting Runtime Kernelのコード
- credential、APIキー、`.env`、`.dev.vars`

理由:

- 生ログは未確定案、分岐、重複、内部情報を含み、実装正本として不適切である。
- 新リポジトリはgreenfield実装とし、旧コードの新規化を主張しない。
- 整理済みtopicsだけで、判断根拠と確定仕様を追跡可能にする。

## 13. 提出前の停止条件

次の一つでも満たさない場合、追加機能を止めてFlagshipの修復を優先する。

- 新規ブラウザ環境でログインできない。
- judge userがBYOKなしで実行できない。
- private情報が承認前にshared viewへ出る。
- shared/private経路を利用者が判別できない。
- Decisionの根拠と前提を追跡できない。
- 外部イベントから`AT_RISK`と人間確認後の`REVIEW_REQUIRED`まで進めない。
- 3分未満の動画と実アプリの挙動が一致しない。
- READMEの操作手順を別環境で再現できない。
- 審査credentialまたはproduction secretが公開面へ露出する。

## 14. 参照

- OpenAI Build Week Official Rules: <https://openai.devpost.com/rules>
- Devpost Testing Guide: <https://help.devpost.com/article/190-testing-guide>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- OpenAI Realtime WebRTC: <https://developers.openai.com/api/docs/guides/realtime-webrtc>
