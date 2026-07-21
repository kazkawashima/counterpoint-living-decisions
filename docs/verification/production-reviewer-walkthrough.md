# Production reviewer walkthrough

更新日: 2026-07-21  
対象: Descant — Living Decisions  
目的: canonical Productionで、private contextからDecision revision 3と
JSON exportまでの意味的な実導線を人間が確認する。

この確認は3分リハーサルやhosted C5 security matrixではない。操作時間は問わず、
各状態が順番どおり永続化されることを確認する。すべて合成データを使用し、credential、
API key、browser storage、Network responseの値をスクリーンショットへ含めない。

## 開始条件

- URL:
  <https://counterpoint-living-decisions-production.gs2safari.workers.dev>
- 旧URL `counterpoint-living-decisions.gs2safari.workers.dev` は使用しない。
- 非公開Testing Instructionsで渡された `judge` identityを使用する。
- 標準経路はserver-fundedであり、個人API keyの入力は不要。
- `Judge-managed access` と `Ready` が表示されることを確認する。必要な場合だけ
  `Optional judge BYOK · tab only` を利用できるが、本確認の合格条件には含めない。

## シナリオ

| #   | 操作                                                                                                                                                                                                                                                                                                                                     | 期待される結果                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `judge`でログインし、`Global AI Product Rollout` の `Open workspace` を押す。                                                                                                                                                                                                                                                            | seed済みFlagshipが開き、private/sharedの領域と5段階の進行表示が見える。                                                                      |
| 2   | 以前の状態が残っていれば `Reset staged demo` → `Confirm meeting reset` を押す。                                                                                                                                                                                                                                                          | `Meeting reset complete · synthetic Context restored` が表示され、対象meetingだけが初期状態へ戻る。                                          |
| 3   | Private領域の `Staged private note` を確認し、`Prepare grounded sharing preview` を押す。                                                                                                                                                                                                                                                | private assistantが共有候補を作る。候補を見ただけではshared Evidenceは増えず、sourceはprivateのまま。                                        |
| 4   | `Outgoing preview` のexact excerpt、`Source range`、`Origin · AI suggestion · owner only`を確認し、`Approve exact excerpt` を押す。                                                                                                                                                                                                      | previewに表示された範囲だけがshared Evidenceとして公開され、周辺のprivate noteは共有されない。                                               |
| 5   | `Candidate workbench`でtitle、outcome、premise、retained dissent、Action、monitor conditionを読み、`Confirm edited premise` を押す。                                                                                                                                                                                                     | AI提案が人間確認済みpremiseへ変わる。AIだけではDecisionはcommitされない。                                                                    |
| 6   | `Save Decision draft` → `Validate and mark ready` → `Commit Decision` の順に押す。                                                                                                                                                                                                                                                       | `Human committed`、`Revision 2 · COMMITTED`、`Drafted → MarkedReady → Committed` が表示される。                                              |
| 7   | `Start Decision monitor` を押す。                                                                                                                                                                                                                                                                                                        | `Monitoring active` とmonitor registrationが表示される。これは実世界の常時監視を意味しない。                                                 |
| 8   | `Inject staged regulatory event` を押す。                                                                                                                                                                                                                                                                                                | `Staged demo event · External event received` が表示され、合成イベントであることが明示される。                                               |
| 9   | AI評価完了を待つ。                                                                                                                                                                                                                                                                                                                       | `AT_RISK · AI suggestion`、affected premise、affected Action、confidence/reasonが表示される。revision 2はまだimmutable。                     |
| 10  | `Facilitator review reason`へ `The staged regulatory event changes the approval-gate premise and requires human reconsideration.` と入力し、`Confirm impact and open review` を押す。                                                                                                                                                    | `REVIEW_REQUIRED · Human confirmed`、Action held、open reconsideration taskが表示される。AI提案と人間確定が別イベントとして残る。            |
| 11  | `Resolve Decision review`で `Commit revised Decision` を選ぶ。                                                                                                                                                                                                                                                                           | `Before · Revision 2` と `After · Proposed revision 3` が並び、revision 2を上書きせずappendする説明が表示される。                            |
| 12  | 4項目を確認または次の合成値へ編集する。Title: `Regulation-aware regional launch`。Outcome: `Pause regional launch until the revised regulatory approval gate is satisfied.`。Monitor: `Monitor the revised approval gate before resuming regional launch.`。Reason: `The staged regulation requires a documented revised approval gate.` | Before/After比較に入力内容が反映される。実在組織・人物・規制情報は入力しない。                                                               |
| 13  | `Commit revision 3` を押す。                                                                                                                                                                                                                                                                                                             | `Human resolution recorded`、`Revision 3 is now active`、`Flagship arc complete`、auditの`RevisionCommitted`が表示される。                   |
| 14  | `Prepare Decision JSON export`を押し、表示された`Download JSON`を実行する。                                                                                                                                                                                                                                                              | download表示が`3 revisions`を含み、JSONにrevision 1–3、current revision 3、history/auditが含まれる。秘密情報やprivate note全文は含まれない。 |
| 15  | ページをreloadし、同じFlagshipを再度開く。                                                                                                                                                                                                                                                                                               | `Revision 3 · COMMITTED`または`COMMITTED · Revision 3`が残り、staged external eventとresolution結果が復元される。                            |

## 合格条件

次のすべてを満たしたら、このhosted semantic walkthroughを合格とする。

- exact excerpt以外のprivate noteがshared画面またはJSONへ出ない。
- DecisionはAI提案だけではcommitされず、人間操作でrevision 2になる。
- staged eventだけでは`REVIEW_REQUIRED`にならず、facilitator確認後に遷移する。
- recommitがrevision 2を変更せず、append-onlyのrevision 3を作る。
- exportが3 revisionsとaudit/historyを持ち、reload後もrevision 3がcurrentである。
- 途中で`Artifact storage is temporarily unavailable`、503、認証要求、無関係な
  usage-limit再試行へ落ちない。

## 失敗時の記録

失敗した場合は再操作を連打せず、次だけを記録する。credentialやAPI keyは記録しない。

1. 失敗した手順番号と押したボタン。
2. 画面のerror code/messageと、その直前に表示されていたDecision state/revision。
3. DevTools Networkのrequest method、path、HTTP status、公開可能なerror code。
4. credentialを隠した画面スクリーンショット。
5. reload後に状態が維持されたか。

確認後に別のレビュワーが再実行する場合だけ、`Reset staged demo`でFlagshipを初期化する。
resetは既存のrevision/historyを削除するため、必要なJSONと証拠を保存してから行う。
