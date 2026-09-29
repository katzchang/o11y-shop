# デモ台本：計装の品質が良くなきゃAIも辛かろうね（15分）

Splunk Observability Studio（obstudio）の紹介セッション用の台本です。

> SplunkもAI AssistantやAI SREといった組み込みのAIエージェントを持ち、MCPやAPIを通じてコーディング支援エージェントとも連携できます。それなりに動きます。ただしそれは、対象のシステムから、それなりのテレメトリーが得られればの話です。
>
> では、そのテレメトリーの質は誰がどう担保するのか。計装の品質をどう管理し、AIにどう計装させるのか。Splunk Observability Studioを使った例で考えます。

## 場面ごとのブランチ

デモではブランチを切り替えて、各段階の状態を見せます。これらのブランチはローカルにだけあり、GitHub には push していません。

| ブランチ | 状態 |
|---|---|
| `demo/0-before` | 計装前（main と同じ）。payment-svc は計装なし、サービス名もなし |
| `demo/1-instrumented` | `$otel-instrument` と `$otel-verify` の後。payment-svc を計装済み、サービス名と環境名を設定済み |
| `demo/2-rule-violation` | Weaver の独自ルールあり。決済 span に注文番号がない（違反が出る） |
| `demo/3-rule-fixed` | Weaver の独自ルールあり。決済 span に `shop.order.id` がある（違反が消える） |

## 事前準備（本番前日〜直前）

### 1. Weaver のラッパーをリポジトリの外に置く

`weaver/` ディレクトリは `demo/2` 以降にしかありません。リポジトリの外に置いたラッパーが「今のブランチに `weaver/registry` があれば独自ルールを使い、なければ素の weaver を呼ぶ」ようにしておけば、ブランチを切り替えるだけでルールの有無も切り替わります（obstudio の再起動は不要）。

```bash
mkdir -p ~/.local/share/o11y-shop
cat > ~/.local/share/o11y-shop/weaver <<'EOF'
#!/bin/sh
repo=$HOME/Documents/o11y-shop/weaver
real=$HOME/.claude/skills/obstudio/weaver
if [ "$1" = registry ] && [ "$2" = live-check ] && [ -d "$repo/registry" ]; then
  exec "$real" "$@" --registry "$repo/registry" --include-unreferenced --advice-policies "$repo/policies"
fi
exec "$real" "$@"
EOF
chmod +x ~/.local/share/o11y-shop/weaver

# obstudio はこのラッパーを指定して起動する
WEAVER_PATH=~/.local/share/o11y-shop/weaver make run
```

### 2. オフライン対策

独自レジストリは、検証のたびに OTel semconv v1.44.0 を GitHub から取得します。会場のネットワークが不安なら、事前にローカルへ置いておきます。

### 3. Claude Code の用意

o11y-shop のディレクトリで Claude Code を起動し、`/mcp` で obstudio の MCP がつながっていることを確認します。

## 当日の起動手順

```bash
cd ~/Documents/o11y-shop
git switch demo/0-before
./scripts/start.sh          # 専用のターミナルで。止めるときは Ctrl-C
```

開いておく画面：

- ブラウザのタブ 1：http://localhost:8080/ （喫茶店の UI）
- ブラウザのタブ 2：http://127.0.0.1:3000/ （obstudio）
- ターミナル：Claude Code

## 本編

### 0:00–2:00　導入（スライド）

- Splunk には AI Assistant や AI SRE があり、MCP 経由でコーディングエージェントとも連携できる。それなりに動く
- ただし、それは相手のシステムから、それなりのテレメトリが取れていればの話
- 今日の問い：テレメトリの質を誰がどう担保するのか。AI にどう計装させるのか

### 2:00–4:30　場面 1：質の悪いテレメトリで AI に調べさせる（`demo/0-before`）

1. UI で注文して「毎度ありィ!!」を見せる
2. 障害を起こす：

   ```bash
   ./scripts/slow-gateway.sh 1500
   ```

   UI が「ギャアアアッ!!」になり、注文一覧が赤く埋まる。

3. Claude Code に聞く：

   > obstudio の MCP を使って、決済のエラーが増えている原因を調べて

4. 見せたいこと：
   - サービスは `unknown_service:node` しかない
   - トレースは order-api で途切れていて、AI は「payment-svc への呼び出しが 1 秒でタイムアウトしている」までしか言えない
   - 失敗扱いの注文が実は課金済みだったことには気づけない

   ⚠️ 要リハーサル：AI が本当にここで止まるかは未確認。もし payment-svc のログから課金済みに気づいてしまったら、「ログを突き合わせればたどり着けるが、トレースでは見えない」という話に切り替える。

5. 遅延を戻す：`./scripts/slow-gateway.sh 200`

### 4:30–8:30　場面 2：AI に計装の品質を上げさせる

1. 監査の結果（`.observe/otel.html`）を見せる
   - 見せる指摘：OTEL-001（payment-svc に計装がない）、OTEL-002（サービス名がない）、OTEL-003（旧属性が重複している）
   - 生成済みのレポートを見せるだけにする。監査をライブで実行すると数分かかる
2. 計装と検証の結果（`.observe/otel-instrumentation.html`）を見せる
   - AI に `$otel-instrument --ids OTEL-001,OTEL-002` を実行させた結果
   - 検証（`$otel-verify`）で実際にスタックを起動して確かめたところ、AI 自身の実装の不具合が 2 つ見つかった（Go の OTLP エクスポーターの既定が HTTPS だったこと、`http.route` が付かなかったこと）。それを直したうえで合格している
   - 「AI に計装させて、AI に検証させる。任せっぱなしにしない」を伝える場面
   - ライブ実行は、検証を含めると 10 分以上かかるので避ける
3. 計装後のコードに切り替える（`start.sh` を Ctrl-C で止めてから）：

   ```bash
   git switch demo/1-instrumented
   ./scripts/start.sh
   ```

   obstudio の Services に order-api と payment-svc が並ぶことを見せる。

### 8:30–11:00　場面 3：同じ質問をもう一度 AI にする

1. 障害を起こす：`./scripts/slow-gateway.sh 1500`
2. Claude Code に、場面 1 と同じ質問をする
3. 見せたいこと：トレースがつながったので、AI が次の順にたどれる
   - order-api は 1 秒で諦めて 502 を返した
   - payment-svc はゲートウェイ呼び出しを続けた（約 1.7 秒）
   - 結果、失敗扱いの注文が課金されている
4. obstudio のトレース画面でも見せる：Traces → `Min Duration >= 900` で絞る → タイムアウトしたトレースを開く → payment-svc の区間が order-api より右に伸びている
5. 遅延を戻す：`./scripts/slow-gateway.sh 200`

### 11:00–13:30　場面 4：品質を守り続ける（Weaver の独自ルール）

1. 独自ルール（`weaver/policies/shop.rego`）を画面で数行だけ見せる：「決済の span には注文番号 `shop.order.id` が必須」
2. ルールがあるブランチに切り替える：

   ```bash
   git switch demo/2-rule-violation
   ./scripts/start.sh
   ```

3. 注文を数件流してから、obstudio の Validation → Validate → Spans を開く。`POST /charges` に `missing_order_id` の violation が出る
4. 直したブランチに切り替えて、再起動して Validate する：

   ```bash
   git switch demo/3-rule-fixed
   ./scripts/start.sh
   ```

   `missing_order_id` が消え、`POST /charges` の属性に `shop.order.id` が出る。

5. 話すポイント：注文番号があれば、AI も人も「この注文の決済」を ID でたどれる。規約をルールにしておけば、計装の質が落ちたときに気づける

### 13:30–15:00　まとめ（スライド）

- AI エージェントの出来は、テレメトリの質しだい
- 質を上げる：監査 → AI による計装 → 実際に届いたかの検証
- 質を守る：Weaver のルールで、規約からの逸脱を検知する
- これを手元で回せるのが Splunk Observability Studio

## 本番での注意

- **場面 4 は切り替えてすぐ Validate する**：データを溜めすぎないよう、切り替えてから 1 分以内を目安にする。
- **古いデータの混在**：ブランチを切り替えても obstudio のデータは残る。場面 4 で古い違反と新しい状態が混ざって見えにくければ、Validate の前に MCP の `observer_clear` か obstudio の再起動でデータを消す（再起動する場合は `WEAVER_PATH` を付けるのを忘れずに）。
- **余計な指摘**：order-api の旧 HTTP 属性（OTEL-003）の violation は、どの場面でも出る。「これも監査で見つかっていた」と触れるか、流すかを決めておく。
- **`tcp.connect` の長いトレース**：場面 3 で 14 秒台のトレースが一覧の上に来ることがある。`Min Duration` の上限も指定して絞るか、「ノイズの見極めもオブザーバビリティの力」と一言添えるかを決めておく。
- **ブランチを切り替えた後は必ず再起動**：`start.sh` を Ctrl-C で止めて起動し直さないと、古いコードのまま動き続ける。
