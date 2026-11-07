# Provider permission register

States: `not_evaluated`, `candidate`, `approved`, `denied`, `suspended`.

| Source          | State         | Authorized project scope | Reviewer / approval date | Credentials | Evidence                         |
| --------------- | ------------- | ------------------------ | ------------------------ | ----------- | -------------------------------- |
| Best Buy        | candidate     | None established         | Unassigned / none        | Absent      | Official docs only; not approval |
| Other retailers | not_evaluated | None                     | Unassigned / none        | Absent      | None                             |

Before approval record reviewer, dated written terms decision, authorized fields and uses, retention/display restrictions, allowed hosts, seller/channel/region semantics, quotas, pricing and permitted cadence; then run a scoped credentialed smoke test. Denied/suspended sources must not run. Credentials never grant approval. Runtime guard requires approved, enabled, reviewer, evidence URL and a credential. No production network adapter exists at A-01.

`retailer_verification` remains false. Feature flags do not override source permissions. Legal/content approval and real integration remain outstanding.
