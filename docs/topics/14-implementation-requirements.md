# 14 — Counterpoint — Living Decisions 実装要件

作成日: 2026-07-19  
対象リポジトリ: `https://github.com/kazkawashima/counterpoint-living-decisions`  
移行元: `meeting-runtime-kernel` および `docs/newEra/basedtalks/topics`

## 1. 文書の位置づけ

本書は、既存の Meeting Runtime Kernel を新リポジトリへ移し、OpenAI Build Week に提出可能な **Counterpoint — Living Decisions** へ進化させるための合意済み実装要件である。

関連する構想・状態モデル・MVP境界は次を参照する。

- [11-state-model.md](./11-state-model.md)
- [12-counterpoint-living-decisions.md](./12-counterpoint-living-decisions.md)
- [13-mvp-scope.md](./13-mvp-scope.md)

本書で明示的に確定した内容は、上記文書内の「未確定候補」より優先する。

## 2. 確定したプロダクト

提出本体は **Counterpoint + Living Decisions** とする。

一文定義:

> 各参加者が保持する私的文脈を本人の明示承認によって共有状態へ接続し、会議の主張・前提・根拠・異論・決定を監査可能な状態として維持し、外部環境の変化によって決定を再検討可能にする Decision Runtime。

中核体験:

```text
Private context
→ Permissioned evidence
→ Shared decision state
→ Explicit assumptions
→ Commitment
→ External event
→ Assumption invalidated
→ REVIEW_REQUIRED
→ Actions held / revisit task
```

## 3. 成功条件

ハッカソン版は、次の価値を一つの連続した体験として証明する。

1. 会議参加者ごとにprivateな資料とエージェントが存在する。
2. privateな情報は、本人の明示承認なしに共有されない。
3. 場への発話とprivate agentへの発話を、利用者が明示的に切り替えられる。
4. 発言事実、AI推定、本人確認済み情報が混同されない。
5. 会議から、根拠・前提・異論・Actionを持つDecisionが生成される。
6. 外部イベントが前提を失効させると、Decisionが自動的に再検討状態へ移る。
7. 上記を3分程度のデモで理解できる。

## 4. 利用者と画面

### 4.1 ロール

- ファシリテーター
  - 会議を作成する。
  - 参加者を割り当てる。
  - 会議スコープのOpenAI APIキーを設定する。
  - AI推定の確認、DecisionのCommit、デモイベント投入、デモ初期化を行う。
- 参加者
  - 自分のprivate資料を登録する。
  - 場またはprivate agentへ音声・テキストで発話する。
  - private evidenceの共有範囲を編集し、明示承認する。
- 共有スクリーン
  - shared state、論点、前提、根拠、異論、Decision、Actionを読み取り専用で表示する。
  - 失効可能かつ推測困難なURLで別タブまたは別モニターに表示する。

### 4.2 画面構成

Reactアプリ内に次の独立した表示面を持つ。

- ログイン
- 参加可能会議一覧
- ファシリテーターダッシュボード
- 参加者private workspace
- 共有スクリーン
- Decision履歴・監査ビュー
- ガイド付きデモ選択・初期化

## 5. 認証と会議参加

### 5.1 簡易ログイン

- ハッカソン版は固定デモユーザーを使用する。
- ユーザーとpassword hashは環境設定で定義する。
- 自己登録、OAuth、パスワード再発行は実装しない。
- 認証成功時に短期Bearer sessionを発行する。
- Bearer sessionはタブ単位の`sessionStorage`へ保持する。
- APIとWebSocketの両方で同じsession identityを検証する。
- 無操作期限は2時間、絶対期限は8時間とする。
- 排他ログインは行わない。

`sessionStorage`を選ぶ理由は、同一ブラウザの複数タブで別ユーザーを同時に操作し、一人でも複数参加者デモを実行可能にするためである。

### 5.2 会議参加

- 会議人数はファシリテーターを含む3〜8人とする。
- ファシリテーターは固定ユーザーを会議へ割り当てる。
- 割り当て済みユーザーには、ログイン後の参加可能会議一覧へ対象会議を表示する。
- 会議コードによる参加も予備導線として残す。
- すべてのデータ、接続、一時状態、APIキーを会議単位で分離する。

## 6. OpenAI APIキー

### 6.1 利用方針

- 一般公開利用はBYOKを必須とする。
- Devpost審査アカウントは、審査員に費用・APIキー準備を要求しないserver-funded judge modeを使用する。
- judge modeの標準APIキーはCloudflare Worker Secret `OPENAI_API_KEY_JUDGE`として登録し、`wrangler.toml`、D1、R2、ログ、リポジトリへ保存しない。
- ローカルではgit管理外の`.env`または`.dev.vars`から標準APIキーを読み込める。
- ファシリテーターが入力したキーは、対象会議だけに適用する。
- 参加者へ標準APIキーを開示しない。
- judge modeは審査専用ユーザーだけに許可し、一般ユーザーへserver-funded keyを使用させない。
- judge modeにはアカウント、IP、会議、Realtime接続時間、token、日次総額のhard limitを設ける。
- 審査用credentialは公開README、動画、リポジトリ、Devpostの公開説明欄へ記載しない。
- Devpostの`Testing Instructions`へ記載する場合も、提出プレビューとログアウト状態で一般公開されないことを実確認する。
- Devpost上の非公開性を確認できない場合、credentialは審査用に共有したprivate repositoryの案内または運営指定の非公開経路から渡し、漏洩前提の利用上限を維持する。

### 6.2 保持と破棄

- BYOKはブラウザではファシリテーターの`sessionStorage`だけに保持する。
- BYOKはサーバーでは会議Durable ObjectまたはNodeプロセスのメモリだけに保持する。
- judge modeの標準APIキーはWorker Secret bindingからOpenAI呼び出しと短期client secret発行にだけ使用し、ブラウザまたは会議状態へ複製しない。
- D1、SQLite、R2、ローカルファイル、ログ、監査イベントへ保存しない。
- ファシリテーター接続中はheartbeatでkey leaseを更新する。
- 明示ログアウト、会議終了、ログインセッション失効、切断後5分のうち最も早い時点でサーバー側コピーを破棄する。
- WorkerまたはDurable Objectの退避によってキーが消えた場合は、ファシリテーターへ再入力を求める。

ブラウザ終了はサーバーから確実に検知できない。したがって保証は次の通りとする。

- ブラウザ側: タブまたはブラウザセッション終了時に原則消去
- サーバー側: 最終heartbeatから最大5分以内に消去
- 既知制約: ブラウザのクラッシュ復元機能が`sessionStorage`を復元する場合がある

## 7. 音声・テキスト経路

### 7.1 二つの発話経路

参加者は入力前またはpush-to-talk中に、発話経路を明示的に選択する。

- `Speak to room`
  - 場への発話としてtranscriptを共有イベントへ記録する。
  - 全参加者のprivate agentへshared context eventとして配信する。
  - 共有スクリーンへ反映する。
- `Speak privately`
  - 本人のprivate agentだけへ送る。
  - private資料とshared stateを参照できる。
  - 本人の承認前はshared event、共有スクリーン、他参加者のagentへ送らない。

テキスト入力は常に代替経路として利用可能にする。

### 7.2 Realtime接続

- sharedとprivateは別OpenAI Realtime sessionにする。
- サーバーは会議APIキーを使って短期client secretを発行する。
- 各ブラウザは短期secretを使い、OpenAI RealtimeへWebRTCで直接接続する。
- 標準APIキーおよび他参加者のprivate contextをRealtime clientへ渡さない。
- 人間同士の音声配送は行わない。
- Zoom相当の遠隔音声会議はMVP外とする。
- 共有transcriptと確定イベントはアプリサーバーへ集約する。

## 8. 資料と権限付き共有

### 8.1 資料

各参加者は、複数のprivate資料とURLを登録できる。会議の共有場にも資料を提示できる。

対応範囲:

- PDF
- Markdown
- plain text
- OpenAI APIが直接扱えるファイル形式
- 公開HTTP(S) URL

上限:

- 1ファイル20MB
- 1人10件
- 1会議100MB

### 8.2 URL取得防御

- `http`と`https`だけを許可する。
- loopback、private、link-local、metadata endpointへの接続を拒否する。
- redirectごとに宛先を再検査する。
- 応答サイズ、timeout、redirect回数、content typeを制限する。
- 取得した内容を実行せず、非信頼入力として処理する。

### 8.3 PrivateからSharedへの昇格

- private agentは関連根拠を候補として本人だけに表示する。
- 候補には出典と引用範囲を付ける。
- 本人は共有するスニペットを編集できる。
- 本人が明示承認した範囲だけをshared evidenceへ昇格する。
- 承認者、時刻、元資料、共有範囲を監査イベントへ残す。
- AI要約だけで元資料全体の共有を暗黙に許可しない。

## 9. 会議状態とLiving Decision

### 9.1 不変原則

既存Meeting State Modelの次の原則を維持する。

1. 発言事実とAI推定を分離する。
2. sharedとprivateを分離する。
3. 支持者数と案の質を分離する。
4. 合意量の最大化を目的にしない。
5. Decisionまでの出典と遷移を追跡可能にする。

### 9.2 中核エンティティ

- Meeting
- Participant
- SourceArtifact
- Utterance
- Proposition
- Stance
- Question
- Claim
- Premise
- Evidence
- Option
- Criterion
- Constraint
- Risk
- Evaluation
- Decision
- Dissent
- Action
- Intervention
- ExternalEvent
- DecisionRevision

### 9.3 Decision lifecycle

```text
DRAFT
→ DECISION_READY
→ COMMITTED
→ MONITORING
→ AT_RISK
→ REVIEW_REQUIRED
→ COMMITTED | SUPERSEDED | REJECTED
```

- Decisionは依存前提、根拠、異論、Action、監視条件を持つ。
- 更新時に既存Decisionを上書きせず、revision履歴を追加する。
- AIは候補を生成できるが、Commitはファシリテーターの明示操作を必要とする。
- AI推定前提は、本人またはファシリテーターの確認状態を持つ。

### 9.4 外部イベント

- MVPのmonitor adapterは署名付きWebhook/APIとする。
- 同じ経路を呼ぶデモ用イベント投入ボタンを用意する。
- 外部イベントとDecisionの依存前提をGPT-5.6で評価する。
- 前提失効候補は根拠付きで記録する。
- 失効確定時にDecisionを`REVIEW_REQUIRED`へ遷移する。
- 影響を受けるActionを保留し、再検討タスクを生成する。

## 10. アーキテクチャ

採用方式は **Edge-native + runtime adapters** とする。ドメイン中核を共通化し、ローカルNode runtimeとCloudflare runtimeを分離する。

### 10.1 構成

- `apps/web`
  - React + Vite
  - ファシリテーター、参加者private、共有スクリーンを提供する。
- `apps/worker`
  - Cloudflare Worker adapter
  - HTTP API、認証、Realtime secret発行、Webhook、D1/R2/DO接続を担当する。
- `apps/server`
  - Docker Compose用Node adapter
  - ビルド済みReact、HTTP API、WebSocketを単一コンテナで提供する。
- `packages/domain`
  - エンティティ、値オブジェクト、Reducer、状態機械、ドメインルール
  - React、Node、Cloudflare、OpenAIへ依存しない。
- `packages/application`
  - ユースケース、ACL、承認フロー、Decision再評価
- `packages/protocol`
  - API DTO、WebSocket event、error schema
- `packages/ports`
  - repository、artifact storage、realtime publisher、AI gateway、clock、ID generator
- `packages/adapters-node`
  - SQLite、ローカルファイル、Node WebSocket
- `packages/adapters-cloudflare`
  - D1、R2、Durable Objects
- `packages/adapters-openai`
  - GPT-5.6、Realtime client secret、structured output

### 10.2 Cloudflare

- React静的assetとHTTP APIをWorkerから配信する。
- 会議ごとにDurable Objectを一つ割り当てる。
- Durable Objectは接続、イベント順序、会議スコープの一時状態、API key leaseを管理する。
- D1は固定ユーザー、会議メタデータ、参加者割り当て、追記イベント、Decision revision、監査履歴の正本とする。
- R2は資料本体と派生artifactを保持する。
- Cloudflare ContainersはMVPで使用しない。
- 将来、重い文書処理が必要になった場合だけdocument processing adapterとして追加可能にする。

### 10.3 ローカル

- `docker compose up`だけで起動できる。
- Node serverがビルド済みReactとAPIを同じoriginで配信する。
- SQLiteと資料ディレクトリをnamed volumeへ保存する。
- OpenAI APIキーがない場合はファシリテーター入力を要求する。
- 開発用にhot reload構成を別profileとして持てるが、審査用の標準起動はproduction buildとする。

### 10.4 状態更新

状態は追記イベントを正本とし、Reducerからprojectionを生成する。

```text
Command
→ Authorization
→ Domain validation
→ Append event
→ Reduce
→ Persist projection
→ Publish scoped event
```

AI応答を直接正準状態へ書き込まず、候補イベントと確認イベントを分ける。

## 11. データ分離

- すべてのrepository queryは`meetingId`を必須にする。
- private recordは`ownerParticipantId`を必須にする。
- shared recordは対象会議のactive participantだけが読める。
- Commitment操作はファシリテーターだけが実行できる。
- 共有スクリーンは読み取り専用display tokenで対象会議のshared projectionだけを読める。
- display tokenは失効可能にする。
- R2 object keyは会議と所有者の境界を含める。
- ファイル取得は短期認可URLまたは認可済みWorker経由に限定する。

## 12. デモシナリオ

### 12.0 開発優先順位

締切までの最優先目標は、**Flagshipシナリオ一本を最初から最後まで実動させること**である。

- Flagshipの受け入れ基準を満たすまで、Quickstart、Meta demo、追加monitor、追加画面を実装しない。
- 完成とは、ログインからprivate evidence、shared decision、Commitment、外部イベント、`REVIEW_REQUIRED`までを新規環境で再現できる状態を指す。
- 補助テンプレート、装飾、汎用化、追加adapterは、Flagship完成後に残時間がある場合だけ着手する。
- 未完成の機能を広く見せるより、一本の縦切りを動画・デモ・READMEで同一に説明する。

### 12.1 Flagship: グローバルAI製品展開

目的:

> 安全性、法務、技術、顧客コミットが異なる参加者のprivate contextへ分散している状況で、条件付きの展開Decisionを作り、規制変更によって再検討へ移す。

想定ロール:

- Product / Facilitator
- Safety
- Legal
- Engineering
- Enterprise Sales

体験:

1. 各ロールが異なるprivate資料を持つ。
2. shared discussionでは不足している根拠をprivate agentが検出する。
3. 本人が必要範囲だけを共有する。
4. 展開地域、段階、停止条件、責任者を持つDecisionをCommitする。
5. 規制変更イベントをWebhookで投入する。
6. 法的前提が失効し、対象地域のActionだけを保留する。
7. Decisionを`REVIEW_REQUIRED`へ移し、再検討履歴を残す。

### 12.2 Quickstart: 製品リリースGo/No-Go

- 技術、セキュリティ、顧客情報を3人へ分散する。
- 条件付きリリースを決定する。
- 監査遅延イベントによって再検討へ移す。
- 初見利用者が短時間で操作を理解するための簡易テンプレートとする。

### 12.3 Meta demo: ハッカソン審査会議

- 各審査員が紹介リール、デモ、README、個別所見をprivate contextとして保持する。
- shared discussionから評価基準、根拠、異論、順位Decisionを形成する。
- 各審査員の未公開評価は明示共有までprivateに保つ。
- 新しい適格性情報またはデモ不通イベントによって評価Decisionを再検討できる。

Flagshipだけを完全なガイド付き実演として作る。QuickstartとMeta demoはFlagship完成後の任意項目とし、実装できない場合は将来候補の文書またはseed fixtureに留める。

## 13. デモデータと初期化

- 会議、Decision、監査履歴、資料は再起動後も永続化する。
- ファシリテーターは自分が作成したデモ会議を初期状態へ戻せる。
- 初期化は対象会議だけに適用し、他会議へ影響させない。
- ガイド付きデモは再実行可能なseed dataと段階表示を持つ。
- 一人デモは複数タブで別ユーザーへログインして実行できる。
- 実際の複数端末・複数人操作も同じAPIと画面で動作する。

## 14. エラー処理と観測性

### 14.1 エラー形式

APIとWebSocketのエラーを次の構造へ統一する。

```text
code
message
correlationId
retryable
details
```

- 利用者向け説明と開発者向け詳細を分ける。
- OpenAI、D1、R2、Realtime接続の失敗元を識別できるcodeを持つ。
- エラーメッセージへAPIキー、Bearer token、private本文を含めない。

### 14.2 Degraded mode

OpenAI APIが利用できない場合も次を継続できる。

- 既存状態の閲覧
- 手動テキスト入力
- 手動での候補・前提・Decision編集
- JSON export
- 監査履歴の閲覧

### 14.3 観測

- 構造化ログ
- correlation ID
- API latency
- OpenAI latency、model、token usage
- WebSocket接続数
- Durable Object会議数
- 失敗率とretry回数

APIキー、生音声、private資料本文はログへ記録しない。

## 15. デプロイ

### 15.1 Docker Compose

標準操作:

```text
docker compose up
```

必須要件:

- 初回起動時にmigrationを安全に適用する。
- ヘルスチェックを持つ。
- SQLiteと資料をvolumeへ永続化する。
- `.env.example`を提供する。
- envキー未設定でも起動し、ファシリテーターBYOKへフォールバックする。
- production相当の単一URLを表示する。

### 15.2 Cloudflare

- Worker、D1 migration、R2 bucket、Durable Object migrationを再現可能なscriptで構成する。
- 初期公開先は`workers.dev`とする。
- custom domainはMVP後の設定項目とし、実装をブロックしない。
- GitHub ActionsはPRでtest/build、`main`で手動承認付きdeployを行う構成を推奨する。
- 一般公開ユーザーにはBYOKを要求し、server-funded keyを使用させない。
- 審査環境では`OPENAI_API_KEY_JUDGE`をCloudflare Worker Secretとして登録する。
- production secretはCloudflare Dashboardまたは`wrangler secret put`で設定し、通常の`vars`、`.env`、`.dev.vars`、GitHub管理対象ファイルへ書かない。
- 審査用credentialとjudge modeを8月5日17:00 PTまで維持し、その後にcredentialを失効してSecretをrotateまたは削除する。

## 16. テスト

### 16.1 Unit

- Reducer
- Decision state machine
- ACL
- private/shared昇格
- 前提失効
- revision生成
- projection

### 16.2 Contract

同じport契約を次の両方へ適用する。

- SQLite / D1
- ローカルファイル / R2
- Node realtime hub / Durable Object

### 16.3 Integration

- 認証とsession失効
- Realtime client secret発行
- event appendとprojection更新
- artifact upload/download
- Webhook署名検証
- Decision再評価

### 16.4 E2E

- 1ブラウザ複数タブの3ユーザー
- 複数端末参加
- 会議一覧と会議コード
- shared/private音声経路
- private evidence承認
- 共有スクリーン
- Commitment
- 外部イベント
- `REVIEW_REQUIRED`
- デモ初期化

### 16.5 Security

- IDOR
- 会議越境
- private record漏洩
- SSRF
- upload content-type偽装
- token失効
- display token失効
- ログへのsecret混入

### 16.6 Deployment smoke

- 空環境からのCompose初回起動
- volumeを保持した再起動
- Cloudflare preview
- Cloudflare production
- D1/DO migration

## 17. 受け入れ基準

1. `docker compose up`だけでローカル起動できる。
2. 固定ユーザー3人を同一ブラウザの別タブで同時に操作できる。
3. ファシリテーターが会議を作成し、3〜8人を割り当てられる。
4. 割り当てユーザーは会議一覧または会議コードから参加できる。
5. BYOKを会議単位に設定でき、参加者へ標準APIキーが開示されない。
6. shared/privateの音声・テキスト経路が分離される。
7. private資料の内容が明示承認前に他参加者、共有画面、shared APIへ現れない。
8. 発言事実、AI推定、確認済み情報がUIと永続データの両方で区別される。
9. DecisionをCommitできる。
10. Webhookイベント一件で前提失効、Action保留、`REVIEW_REQUIRED`、再検討タスク生成まで実行できる。
11. 会議Aのユーザー、資料、イベント、APIキーを会議Bから参照できない。
12. 再起動後も会議、履歴、資料が残る。
13. 対象会議だけをデモ初期状態へ戻せる。
14. ファシリテーター切断後、BYOKのサーバー側コピーが5分以内に破棄される。
15. OpenAI障害時も既存状態閲覧、手動入力、JSON exportが利用できる。
16. Flagshipシナリオの価値弧を3分程度で提示できる。
17. 審査用ユーザーはBYOKなしでFlagshipを完走できる。
18. 一般ユーザーの認証情報ではjudge modeのserver-funded keyを使用できない。
19. judge modeが利用上限へ達した場合、追加課金を発生させず明示的な利用上限エラーを返す。

## 18. MVP外

- Zoom相当の人間向け音声配送
- OAuth
- 自己登録
- 課金
- 本番マルチテナント運用
- AIによる最終決定
- private情報の自動共有
- 完全自動diarization
- 複数monitor adapter
- 常時URL監視
- 組織全体SSoT
- Cloudflare Containers
- 高可用性SLA

## 19. リポジトリと公開方針

- 正式リポジトリ名は`counterpoint-living-decisions`とする。
- 当面はprivate、All rights reservedとして扱う。
- ライセンスはハッカソン提出要件と公開判断を再確認した時点で別途決定する。
- 既存`topics`文書を新リポジトリへ移し、構想根拠と実装仕様を追跡可能にする。
- 既存コードを移す場合は、提出期間内の新規実装範囲をコミットとREADMEで明確に区別する。

## 20. 質疑で確定した判断

- プロダクト: Counterpoint + Living Decisions
- 配置: ローカルはDocker Compose、デモはCloudflare
- 実行方式: 共通Domain Core + Node/Cloudflare runtime adapters
- Cloudflare: Worker + Durable Objects + D1 + R2
- 認証: 固定デモユーザー、タブ単位Bearer session
- 会議参加: 事前割り当て一覧 + 会議コード
- 人数: 3〜8人
- APIキー: 一般利用はBYOK、審査用アカウントはCloudflare Secretのserver-funded judge mode
- Realtime: ブラウザからOpenAIへ短期secretで直接WebRTC
- 音声: shared/private両方必須、人間向け音声通話は対象外
- 資料: 複数ファイル、URL、shared artifact
- private共有: 編集可能な引用スニペットを本人が明示承認
- monitor: 署名付きWebhook + デモ投入ボタン
- 永続化: 再起動後も保持、会議単位に初期化可能
- デモ: 複数タブと実際の複数端末の両方
- Flagship: グローバルAI製品展開
- 補助テンプレート: Go/No-Go、ハッカソン審査会議
- ライセンス: 当面private・All rights reserved

## 21. 実装前に再確認する外部条件

次はプロダクト判断ではなく、着手時点の外部状態確認である。

- OpenAI Build Weekの最新Official Rulesと公開要件
- GPT-5.6およびRealtime modelの利用可能な正式model ID
- OpenAI Realtime client secretの有効期限とsession上限
- Cloudflare Workers、Durable Objects、D1、R2のaccount limit
- Cloudflare production secretとGitHub Actions権限

## 22. 参照

- OpenAI Realtime WebRTC: <https://developers.openai.com/api/docs/guides/realtime-webrtc>
- OpenAI Realtime client secrets: <https://developers.openai.com/api/docs/api-reference/realtime-sessions/create-realtime-client-secret>
- Cloudflare React SPA + Worker: <https://developers.cloudflare.com/workers/static-assets/>
- Cloudflare Vite plugin: <https://developers.cloudflare.com/workers/vite-plugin/tutorial/>
- Cloudflare Workers secrets: <https://developers.cloudflare.com/workers/configuration/secrets/>
- Devpost Testing Guide: <https://help.devpost.com/article/190-testing-guide>
