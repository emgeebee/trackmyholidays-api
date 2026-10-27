# trackmyholidays-api

Serverless backend for [Track My Holidays](https://trackmyholidays.com) and [famtree](https://famtree.buzz). It runs on AWS Lambda behind API Gateway (Serverless Framework v3, Node 22, `us-west-2`) and provides:

- a per-user holidays record (DynamoDB)
- long-lived API tokens, as an alternative to Google ID tokens
- generic JSON document storage (S3), with share links and per-person write access
- a weekly agent that scans the service's CloudWatch logs and writes an error report
- a weekly agent that researches family-tree documents stored in `/docs` and writes a comparable research copy

## Base URLs

| Stage | Base URL |
|---|---|
| prod | `https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod` |
| dev | Each stage has its own API id. Run `npx serverless info --stage dev --aws-profile main`, or see the "Get API URL" step of a PR's deploy run. |

The examples below assume:

```bash
API=https://1q1v3hm1n2.execute-api.us-west-2.amazonaws.com/prod
TOKEN=<google-id-token-or-long-lived-token>
```

## Authentication

Every endpoint except `GET /version` needs an `Authorization: Bearer <token>` header. The token can be:

- a **Google ID token** issued for one of the configured client ids (Track My Holidays or famtree), or
- a **long-lived token** from `POST /generateToken`, which authenticates as the same Google user.

The user id is always taken from the token, never from the URL or body, so users can only reach their own data. Missing or invalid tokens get `401 {"message":"Unauthorized"}`.

API responses only include CORS headers for the origins listed in [`config/allowedOrigins.json`](config/allowedOrigins.json).

## Rate limits

API Gateway throttles each stage to 10 requests per second, with bursts of up to 20. `POST /generateToken` is limited further, to one request every 2 seconds with bursts of 2. Requests over the limit get `429 Too Many Requests` without reaching any Lambda. The limits are shared by all callers, not per user or IP, and are set under `custom.apiGatewayThrottling` in `serverless.yml`.

## Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/version` | Package version, commit and stage. No token needed. |
| `GET` | `/holidays` | Get my holidays record |
| `POST` | `/holidays` | Save my holidays record |
| `PUT` | `/holidays/{id}` | Update my holidays record (currently broken, see below) |
| `POST` | `/generateToken` | Create a long-lived token for me, with an optional name |
| `GET` | `/tokens` | List my long-lived tokens |
| `POST` | `/renameToken` | Rename one of my tokens |
| `POST` | `/expireToken` | Expire one of my tokens |
| `POST` | `/docs` | Create a document |
| `GET` | `/docs` | List my documents |
| `GET` | `/docs/{id}` | Get one of my documents |
| `PUT` | `/docs/{id}` | Replace one of my documents |
| `DELETE` | `/docs/{id}` | Delete one of my documents and its share links |
| `POST` | `/docs/{id}/shares` | Create a share link for my document |
| `GET` | `/docs/{id}/shares` | List my document's share links and who opened them |
| `DELETE` | `/docs/{id}/shares/{code}` | Revoke a share link |
| `PUT` | `/docs/{id}/shares/{code}/access/{userid}` | Set read or write for someone who has opened this link |
| `GET` | `/shared/{code}` | Open a document someone shared with me |
| `PUT` | `/shared/{code}` | Replace a shared document when I have been given write |
### Version

```bash
curl $API/version
```

```json
{"version":"2.1.0","commit":"1a27cc8…","stage":"prod"}
```

### Holidays

Each user has a single holidays record. `POST` stores the whole request body under `text`.

```bash
curl -X POST $API/holidays \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"allowance":25,"booked":["2026-12-24","2026-12-31"]}'
```

```json
{"id":"103501357127260947071","text":{"allowance":25,"booked":["2026-12-24","2026-12-31"]},"checked":false,"createdAt":1791460800000,"updatedAt":1791460800000}
```

```bash
curl $API/holidays -H "Authorization: Bearer $TOKEN"
```

`GET` returns the same record, or an empty body if none has been saved yet.

`PUT /holidays/{id}` is a leftover from the original to-do template. It only accepts `{"text": "<string>", "checked": <boolean>}` and doesn't currently find the user's record, so use `POST` to save changes instead.

### Long-lived tokens

Generate one while signed in with a Google ID token. It lasts 365 days by default, set by `TOKEN_EXPIRY`.

An optional `name` (trimmed, up to 64 characters) is stored with the token and returned by `GET /tokens`. Tokens created before names were added have no name.

```bash
curl -X POST $API/generateToken \
  -H "Authorization: Bearer $GOOGLE_ID_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"CI"}'
```

```json
{"token":"eyJhbGciOiJIUzI1NiIs…","sub":"103501357127260947071","expiresIn":"365d","expiresAt":"2027-10-08T18:00:00.000Z","name":"CI"}
```

List, rename and expire tokens:

```bash
curl $API/tokens -H "Authorization: Bearer $TOKEN"

curl -X POST $API/renameToken \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>","name":"laptop"}'

curl -X POST $API/expireToken \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token-to-expire>"}'
```

```json
{"tokens":[{"token":"eyJhbGciOiJIUzI1NiIs…","userid":"103501357127260947071","name":"laptop","createdAt":"2026-10-08T18:00:00.000Z","expiresAt":"2027-10-08T18:00:00.000Z"}]}
{"name":"laptop"}
{"message":"Token expired."}
```

`renameToken` and `expireToken` return `400` without a `token`, `404` for an unknown token and `403` for someone else's. A name that is missing, not a string, or longer than 64 characters is `400`. API Gateway caches authorizer results for up to five minutes, so an expired token can keep working briefly.

### Documents

Documents are arbitrary JSON objects stored in S3 at `docs/<userid>/<id>.json`. Ids may only contain letters, numbers, `_` and `-` (otherwise `400`).

```bash
# Create (id is optional; a UUID is generated if omitted). 409 if the id already exists.
curl -X POST $API/docs \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10}}'

# List, get
curl $API/docs -H "Authorization: Bearer $TOKEN"
curl $API/docs/summer-trip -H "Authorization: Bearer $TOKEN"

# Replace (keeps createdAt). 404 if it doesn't exist.
curl -X PUT $API/docs/summer-trip \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Summer holiday","data":{"destination":"Spain","days":12}}'

# Delete (also revokes its share links)
curl -X DELETE $API/docs/summer-trip -H "Authorization: Bearer $TOKEN"
```

A document as returned by create, get and update; list wraps them as `{"docs":[…]}`:

```json
{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10},"createdAt":"2026-10-08T18:00:00.000Z","updatedAt":"2026-10-08T18:00:00.000Z"}
```

### Sharing documents

The owner creates a share code for a document. The link itself stays `read`: anyone signed in who has the code can open the document, and opening it records them on that share. The owner can then set `write` for one of those people without changing anyone else. That person can replace the document; it stays under the owner's account. Everyone else gets `403` on update. Setting `read` again removes their write access. Only the owner can list links, change a person's access, or revoke a code. Opening or saving through your own link isn't recorded. The owner always has write.

```bash
# Owner: create, list and revoke share links
curl -X POST $API/docs/summer-trip/shares -H "Authorization: Bearer $TOKEN"
curl $API/docs/summer-trip/shares -H "Authorization: Bearer $TOKEN"
curl -X DELETE $API/docs/summer-trip/shares/<code> -H "Authorization: Bearer $TOKEN"

# Owner: give one person who has already opened the link write access
curl -X PUT $API/docs/summer-trip/shares/<code>/access/<userid> \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"permission":"write"}'

# Anyone signed in with the code. PUT succeeds only for people granted write.
curl $API/shared/<code> -H "Authorization: Bearer $THEIR_TOKEN"
curl -X PUT $API/shared/<code> \
  -H "Authorization: Bearer $THEIR_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Summer holiday","data":{"destination":"Spain","days":12}}'
```

Listing share links:

```json
[{"code":"q3Zr8kP1xW9vYbT2nLm4sA0d","docId":"summer-trip","permission":"read","createdAt":"2026-10-08T18:00:00.000Z",
  "accessedBy":[{"userid":"117283546120394857261","email":"friend@example.com","name":"A Friend","permission":"write","firstAccessedAt":"2026-10-08T19:00:00.000Z","lastAccessedAt":"2026-10-09T08:30:00.000Z","accessCount":3}]}]
```

Opening or saving a shared document. `permission` here is the signed-in person's access, `read` until the owner grants them `write`:

```json
{"permission":"read","doc":{"id":"summer-trip","title":"Summer holiday","data":{"destination":"Spain","days":10},"createdAt":"2026-10-08T18:00:00.000Z","updatedAt":"2026-10-08T18:00:00.000Z"}}
```

`email` and `name` in `accessedBy` come from the visitor's Google sign-in. Long-lived tokens generated before access tracking was added don't carry them.

## Log report agent

`l3Agent` runs every 7 days. It uses a [Strands](https://strandsagents.com) agent on Amazon Bedrock (default model `amazon.nova-lite-v1:0`, set by `L3_AGENT_MODEL`) to query the service's CloudWatch logs for the last 7 days. It saves a markdown report of errors and anything unusual to the document bucket under `reports/`.

The report opens with a traffic summary, so errors can be put in proportion (e.g. "server errors affected 1 of 100 users, 1%"). The figures come from API Gateway access logs in `/aws/api-gateway/holidays-<stage>`, which record one JSON line per request: method, endpoint, status, latency and the signed-in user's id. The agent's `traffic_summary` tool calculates totals, distinct users, status codes, per-endpoint usage, and how many users each error affected. The numbers are computed in code, not estimated by the model.

## Development

```bash
npm install
npm start            # serverless-offline on http://localhost:3001
```

`npm start` runs the API locally. It needs DynamoDB Local, managed by `serverless-dynamodb-local`, with tables created from `offline/migrations`. Documents are written to `offline/docs` instead of S3.

### Configuration

Set as environment variables at deploy time:

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_CLIENT_ID` | yes | Google OAuth client id for Track My Holidays |
| `FAMTREE_GOOGLE_CLIENT_ID` | no | Google OAuth client id for famtree |
| `TOKEN_SIGNING_SECRET` | yes | Secret used to sign long-lived tokens |
| `TOKEN_EXPIRY` | no | Long-lived token lifetime, default `365d` |
| `L3_AGENT_MODEL` | no | Bedrock model for the log report agent |
| `GIT_SHA` | no | Commit reported by `/version`, set by CI |

Allowed CORS origins live in [`config/allowedOrigins.json`](config/allowedOrigins.json).

### Resources per stage

| Resource | Name |
|---|---|
| Holidays table | `holidays-<stage>` (not managed by this stack) |
| Tokens table | `tokens-<stage>` |
| Share links table | `docShares-<stage>` |
| Document bucket | generated name (`docStoreBucket`) |

## Deployment

Deploys run in GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)):

- **Pull requests** deploy to `dev` and then run the live tests.
- **Pushes to `main`** deploy to `prod`.

Each GitHub environment (`dev`, `prod`) needs:

- variables `GOOGLE_CLIENT_ID` and `FAMTREE_GOOGLE_CLIENT_ID`
- secrets `TOKEN_SIGNING_SECRET`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`

To deploy by hand:

```bash
GOOGLE_CLIENT_ID=… TOKEN_SIGNING_SECRET=… \
  npx serverless deploy --stage dev --aws-profile main -r us-west-2
```

## Live tests

After each PR deploys to dev, the workflow runs the tests in [`tests/live`](tests/live) against the real dev API:

1. It polls `GET /version` until the API reports the PR's commit, so the tests never run against an older deployment.
2. It invokes the deployed `generateToken` Lambda directly to get a token for a dedicated `live-test-user`.
3. It runs the tests. Each step is its own test, and steps whose setup failed are skipped with a reason.
4. It invokes `expireToken` to remove the token, whether the tests passed or not. The tests also delete any documents they create.

The AWS user running the tests needs `lambda:InvokeFunction` on `holidays-<stage>-generateToken` and `holidays-<stage>-expireToken`.

To run them yourself:

```bash
API_URL=<dev base url> STAGE=dev AWS_PROFILE=main AWS_REGION=us-west-2 npm run test:live
```

Set `LIVE_TEST_TOKEN=<token>` to use your own token instead of creating one. Set `EXPECTED_COMMIT=<sha>` to wait for a particular deployment first.

## Project structure

```
auth/auth.js            API Gateway authorizer (Google ID tokens and long-lived tokens)
holidays/               holidays, tokens and version handlers, plus shared helpers
holidays/docs/          document and share link handlers and their S3/DynamoDB stores
agents/l3Agent.js       scheduled log report agent
config/                 allowed CORS origins
offline/migrations/     DynamoDB Local table definitions for `npm start`
tests/live/             post-deploy live API tests
serverless.yml          functions, routes, IAM and resources
```
