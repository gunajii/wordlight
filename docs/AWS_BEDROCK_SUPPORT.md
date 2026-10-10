# Amazon Bedrock access — support request

Status: **still blocked at the account level** (MEASURED again 2026-10-09 19:00 UTC; first seen 2026-10-08). WordLight works without Bedrock: the parent summary
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
| Request ID | `5f398b1f-ece7-49ed-bb67-0489cf3bec3d` (2026-10-09 19:00:51 UTC, `apac.amazon.nova-micro-v1:0`, HTTP 400, 517 ms) |
| Identity | root user at the time; to be repeated from the least-privilege IAM user (docs/SECURITY.md) |

## Re-check 2026-10-09 19:00 UTC (`bash tools/aws/bedrock-verify.sh`; output in `.dev/aws/bedrock-verify-20261009T190051Z.txt`)
| Check | Result |
|---|---|
| Identity | root user of the account (an IAM user is still to be set up — docs/SECURITY.md) |
| Region | ap-south-1 (configured and used) |
| `ListFoundationModels` | `amazon.nova-micro-v1:0` and `amazon.nova-lite-v1:0` ACTIVE, inference type `INFERENCE_PROFILE` only |
| `ListInferenceProfiles` | `apac.amazon.nova-micro-v1:0` and `apac.amazon.nova-lite-v1:0` ACTIVE |
| `GetFoundationModelAvailability` | Nova Micro and Nova Lite: region, entitlement, agreement AVAILABLE · **authorization NOT_AUTHORIZED** |
| `Converse` (one call, synthetic numbers) | `ValidationException: Operation not allowed`, HTTP 400 → classified **account-not-authorized**; no further models tried (same cause) |
| Support case | opened 2026-10-08 by the developer; **no reply as of 2026-10-10 00:31 IST** |
| Re-check 2026-10-10 07:14 UTC | unchanged: authorization NOT_AUTHORIZED for Nova Micro and Lite; `Converse` → `ValidationException: Operation not allowed`, HTTP 400, request `8391c65f-899e-41a1-903b-8cfb01bff495`. The console now opens a new Bedrock home page (“Bedrock-mantle” endpoint, projects, API keys) — reachable, but it does not change authorization |
| Budget at that time | `wordlight-credits` actual spend USD 0.90 of 100 (AWS Budgets; lags, gross before credits) |

Not the cause, from the same run: the region (models and profiles are listed and active there), the model identifier
(the APAC profile is listed), IAM (the caller is the root user), throttling (first call of the day), credentials (every
control-plane call succeeded), network (an HTTP 400 answer came back in 517 ms).

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
