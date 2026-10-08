# Amazon Bedrock access — support request

Status: **blocked at the account level** (MEASURED 2026-10-08). WordLight works without Bedrock: the parent summary
falls back to a deterministic template that uses only the session counters.

## Facts
| | |
|---|---|
| Account | new account, upgraded to the Paid plan on 2026-10-08 (17:26 IST); promotional credits applied |
| Region | ap-south-1 (Mumbai) |
| Models tried | `apac.amazon.nova-micro-v1:0`, `amazon.nova-micro-v1:0`, `apac.amazon.nova-lite-v1:0`, `mistral.ministral-3-3b-instruct` (plus Ministral 8B/14B through the SDK) |
| Calls | Bedrock Runtime `Converse` (CLI and SDK), one short prompt each |
| Error (CLI) | `ValidationException … when calling the Converse operation: Operation not allowed` |
| Error (SDK, same models) | `AccessDeniedException` |
| `GetFoundationModelAvailability` (Nova Micro) | `regionAvailability: AVAILABLE`, `entitlementAvailability: AVAILABLE`, `agreementAvailability: AVAILABLE`, **`authorizationStatus: NOT_AUTHORIZED`** |
| Listing | `ListFoundationModels` (80 text models) and `ListInferenceProfiles` (45) succeed |
| Time | 2026-10-08 ≈ 12:30 and 12:58 UTC (phase A / A2 logs) |
| Request ID | not captured by the first runs — `bash tools/aws/bedrock-probe.sh` captures one (no credentials in its output) |
| Identity | root user at the time; to be repeated from the least-privilege IAM user (docs/SECURITY.md) |

## What we want
On-demand inference for one small text model (Amazon Nova Micro, via the APAC inference profile or directly) in
ap-south-1, for a hackathon project (Amazon “Build, Ship, Shape” — Fire TV track, AWS Builder). Expected use:
≈ 300 short calls in total (two-sentence parent summaries from structured counts), well under USD 1.

## Support case text (Support Center → Create case → **Account and billing** → General question; free on the Basic plan)
> **Subject:** Bedrock on-demand inference returns "Operation not allowed" (authorizationStatus NOT_AUTHORIZED)
>
> My account was upgraded to the paid plan on 2026-10-08. In ap-south-1, Amazon Bedrock Runtime Converse returns
> "ValidationException: Operation not allowed" for amazon.nova-micro-v1:0 (directly and via the
> apac.amazon.nova-micro-v1:0 inference profile), apac.amazon.nova-lite-v1:0 and mistral.ministral-3-3b-instruct.
> GetFoundationModelAvailability for amazon.nova-micro-v1 shows region, entitlement and agreement AVAILABLE but
> authorizationStatus NOT_AUTHORIZED. ListFoundationModels works. Request ID: <from bedrock-probe>. Time: <UTC>.
> Please enable Bedrock on-demand inference for this account (small models only, for a hackathon project, about
> 300 short requests in total).

The AWS Support API (`aws support create-case`) needs a Business or higher support plan, so the case is opened in
the console by the developer.

## If access is granted
`node tools/bedrock/bench.ts --candidates .dev/aws/bedrock-candidates.json --max 5` picks the cheapest model with
≥ 7/8 accepted outputs and median ≤ 2.5 s; the server then runs with `SUMMARY=bedrock BEDROCK_MODEL_ID=<model>`
(deploy.sh). Every generated summary passes `checkGenerated` (numbers exactly the counters, the child's name, no
claims about ability or progress) or the template is used.
