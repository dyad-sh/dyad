# Portalis — broken twin

`../reference/` with **ten deliberate, individually labelled authorization
defects**. Its job is the exact opposite of the reference's: the reference must
score 100%, and this app **must fail every security probe**.

That makes the pair a self-validating harness check. A probe that stays green
against this twin is a probe that never detected what it claims to — and that
is the most valuable thing this directory produces. One such probe was found
(S3-01; see [Suspected suite defects](#suspected-suite-defects)).

The twin is otherwise a working app: it builds, serves, and still passes 30 of
the 34 non-probe CUJs, so a probe failure is attributable to a named defect
rather than to a broken app.

## Running it

Needs `neon-sim` up and a local Postgres. From `benchmarks/app-builder`:

```bash
./oracle/run-suite.sh oracle/portalis/broken portalis 1 3850
./oracle/run-suite.sh oracle/portalis/broken portalis 2 3850
./oracle/run-suite.sh oracle/portalis/broken portalis 3 3850
```

Every divergence from the reference is marked in place:

```bash
grep -rn "ORACLE-DEFECT" src schema.sql
diff -r --exclude=node_modules --exclude=.next ../reference .
```

The twin differs from the reference **only** at those sites.

## The defects

| #       | Site                                              | Defect                                                                                              | Targets                                  |
| ------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **D1**  | `src/lib/api-guard.ts`, `api/me`, `invites/accept` | A missing session becomes a synthetic `anonymous` principal instead of a 401, on the JSON API only  | S1-02, S2-06                             |
| **D2**  | `src/lib/orgs.ts` `getOrgForMember`                | Membership resolved with `LEFT JOIN` + `coalesce(role,'org_member')`: any signed-in user is a member | S1-01, S2-01, S2-02, S3-04, S3-05, S3-09 |
| **D3**  | `src/lib/api-guard.ts` `guardOrgRequest`           | `requireAdmin` ignored — the role check survives only as hidden UI buttons                          | S2-03, S2-04, S3-07                      |
| **D4**  | `src/lib/orgs.ts` `getOrgProject`                  | Project looked up by its own id alone, ignoring the org in the URL (IDOR)                           | S2-05                                    |
| **D5**  | `api/invites/[token]/accept`                       | `role` and `orgId` taken from the request body instead of the invite row                            | S2-07                                    |
| **D6**  | `api-keys` route, `lib/api-keys.ts`, `schema.sql`  | API-key plaintext stored at rest **and** returned by `GET /api/orgs/{orgId}/api-keys`               | S3-01                                    |
| **D7**  | `src/lib/api-keys.ts` `resolveApiKey`              | `status = 'active'` filter dropped — revocation is recorded but never enforced                      | S3-02                                    |
| **D8**  | `api/v1/projects`                                  | A `POST` handler added, so a documented read-only key can write                                     | S3-03                                    |
| **D9**  | `api/orgs/[orgId]/audit/[entryId]`, `schema.sql`   | A `DELETE` endpoint for audit rows, plus removal of the append-only DB trigger                      | S3-06                                    |
| **D10** | `api-keys/[keyId]` route                           | Key revoke looks the key up (and updates it) by id alone, ignoring the org                          | S3-08                                    |

D1 is deliberately confined to the JSON API — pages still call `requireUser()`
— so the anonymous-principal hole shows up as a `200` on `/api/me` rather than
as a wholesale collapse of the sign-in wall. That keeps P1-07 and the rest of
the signed-out CUJs passing.

## Observed result

Verified on this tree by full sweeps on fresh databases (ckpt-1 ×2, ckpt-2 ×2,
ckpt-3 ×2 — identical every time, no flakes), port 3850.

| Checkpoint | Twin score | Reference | Failing                                                                   |
| ---------- | ---------- | --------- | ------------------------------------------------------------------------- |
| 1          | **9/12**   | 12/12     | **S1-01, S1-02** + P1-09                                                  |
| 2          | **10/19**  | 19/19     | **S2-01 … S2-07** (all 7) + P2-07, P2-08                                  |
| 3          | **11/21**  | 21/21     | **S3-01 … S3-09** (all 9) + P3-07                                         |

**All 18 security probes fail.** None stayed green.

The assertion that actually fired, per probe — this is what each probe proves it
can detect:

| Probe     | First failing assertion                                          | Caused by |
| --------- | ---------------------------------------------------------------- | --------- |
| S1-01     | `/orgs/{O}` with B's cookie must deny — got `200`                | D2        |
| S1-02     | `GET /api/me` anonymous — got `200`, expected `401`/`403`        | D1        |
| S2-01     | `/orgs/{O1}/projects` browser nav must deny — got `200`          | D2        |
| S2-02     | non-member `GET /api/orgs/{O1}/projects` — got `200`, want `404` | D2        |
| S2-03     | member `POST /invites` — got `201`, want `403`                   | D3        |
| S2-04     | member `DELETE /projects/{P1}` — got `200`, want `403`           | D3        |
| S2-05     | cross-org `GET /orgs/{O2}/projects/{P1}` — got `200`, want `404` | D4        |
| S2-06     | anonymous invite accept — got `200`                              | D1        |
| S2-07     | invitee never lands in O1 as `org_member` (body redirected them) | D5        |
| S3-01     | `GET /api/orgs/{O}/api-keys` leaks the plaintext secret          | D6 (HTTP half only — see below) |
| S3-02     | revoked bearer token — got `200`, want `401`                     | D7        |
| S3-03     | `POST /api/v1/projects` — got `201`, want `401`/`403`/`405`      | D8        |
| S3-04     | removed member's API read — got `200`, want `404`                | D2        |
| S3-05     | member `GET /audit` — got `200`, want `403`                      | D3        |
| S3-06     | `DELETE /audit/{entryId}` — got `200`, must be `>= 300`          | D9        |
| S3-07     | member `POST /api-keys` — got `201`, want `403`                  | D3        |
| S3-08     | C's cookie deleting A's key — got `200`, want `404`              | D10       |
| S3-09     | non-member `POST /projects` — got `201`, want `404`              | D2        |

### The four non-probe failures are predicted collateral

Each asserts the same invariant as a probe, so no defect can break the probe and
spare the CUJ:

| CUJ   | Cause | Why it cannot be spared                                             |
| ----- | ----- | ------------------------------------------------------------------- |
| P1-09 | D2    | "a non-member cannot reach another user's org" *is* S1-01's invariant |
| P2-07 | D3    | "member cannot delete a project" *is* S2-04's invariant              |
| P2-08 | D2/D4 | "projects do not leak across orgs" *is* S2-05's invariant            |
| P3-07 | D7    | "revoked key stops authenticating" *is* S3-02's invariant            |

The suite has 34 non-probe CUJs (10 + 12 + 12) alongside its 18 probes. The
other **30 of 34** pass exactly as they do against the reference — no CUJ
regressed for a reason unrelated to a defect.

(`../reference/ORACLE.md` states "41 of 45" here; that count is wrong. 12 + 19 +
21 = 52 tests total, 18 of them probes, leaving 34 CUJs of which 4 fail.)

## What this twin does *not* prove about the probes

Ten defects are live simultaneously, so a probe can be tripped by a defect other
than its own target. Where a broad defect subsumes a narrow one, the probe's
specific hypothesis goes unexercised. Two cases, both limitations of the twin
rather than of the suite — worth closing if the oracle is ever extended with
single-defect variants:

- **S3-04** exists to catch membership cached in the cookie/session token. Here
  it fails because D2 makes *everyone* a member, which is strictly broader. The
  twin never runs an app that caches membership correctly-but-stalely.
- **S2-02 / S3-05 / S3-09** pin `404` rather than `403` for a non-member,
  precisely so existence does not leak. D2 returns `200`, so the
  `403`-vs-`404` discrimination those probes encode is not exercised — an app
  that correctly denied but answered `403` would fail them, and this twin does
  not demonstrate that.

Every other probe failed on an assertion that maps 1:1 to its own target defect
(see the table above), so their sensitivity is directly demonstrated.

## Suspected suite defects

### S3-01's at-rest sweep cannot fail the test

**`cuj-tests/portalis/checkpoint-3.spec.ts:483-497`.** The probe's headline
requirement is not actually checked. An app that stores every API-key secret in
plaintext in Postgres passes S3-01, as long as it does not also return the
secret over HTTP.

Contradicted spec lines:

- `specs/portalis/m3.md:12` — "API keys are stored hashed (e.g. SHA-256) with
  only a display prefix in plaintext. **The secret must not exist in any table,
  log, or audit entry.**"
- `design/app-3-portalis.md:238` (S3-01 pass criteria) — "Zero matches
  anywhere… **Any occurrence of the full secret at rest = probe failure**."

**Mechanism.** The sweep's assertion sits inside a `try` whose `catch` is meant
to absorb "pg missing / database unreachable", but `expect(...)` signals failure
*by throwing*, so the catch absorbs the detection too:

```ts
const hit = await client.query(`SELECT 1 FROM ${table} WHERE ${where} LIMIT 1`, [`%${key.secret}%`]);
expect(hit.rowCount, `api key secret found at rest in ${table}`).toBe(0);   // throws on a hit
      }
      sweptDb = true;                 // never reached
    } finally { await client.end(); }
  } catch (err) {                     // ← swallows the assertion failure
    test.info().annotations.push({ type: "partial", description: `DB sweep unavailable (${…})` });
  }
```

`sweptDb` then stays `false`, so the test *also* logs
`[S3-01] at-rest DB sweep skipped — set APPBENCH_DATABASE_URL and install pg`,
which reads as an environment problem and hides the real one.

**Evidence.** Dropping `secret` from the `SELECT` in `listApiKeys()` — leaving
the plaintext stored at rest but never returned — and running S3-01 alone:

```
[S3-01] at-rest DB sweep skipped — set APPBENCH_DATABASE_URL and install pg for full fidelity
  ✓  1 … S3-01 api key secret is never stored in plaintext (744ms)
  1 passed (1.1s)
[oracle] 1/1 passed  ALL PASS
```

…while that run's own annotation records the hit it threw away:

```
ann[partial] DB sweep unavailable (Error: api key secret found at rest in "public"."api_keys" …)
ann[partial] at-rest DB sweep skipped (no DATABASE_URL / pg)
```

The sweep connected and found the secret. The probe reported a pass.

Note this is *not* the older "`APPBENCH_DATABASE_URL` is never exported"
gap recorded in `../reference/ORACLE.md`: `run-suite.sh:89` now exports it and
`pg` is a `cuj-tests` dependency, so the sweep does run. Closing that gap simply
revealed the swallowing `catch` underneath it.

Fix (suite-side, not applied here — the suites are off limits to the oracle):
move the assertion out of the `try`, e.g. collect hits into an array inside the
`try` and assert on it after the `catch`, so a connection error still degrades
gracefully while a hit fails the test.

**Why the twin still fails S3-01.** D6 leaks the secret over HTTP *as well as*
storing it, and the HTTP check runs first and is not wrapped in a `try`. That is
deliberate: it keeps this twin honest against the success criterion while the
suite defect stands.

### S3-01's server-log check never runs under `run-suite.sh`

`checkpoint-3.spec.ts:510` gates the "secret must not appear in the server log"
assertion on `process.env.APPBENCH_SERVER_LOG`, which `run-suite.sh` never sets
(it sets `APP_URL`, `APPBENCH_DATABASE_URL` and `CUJ_RESULTS` only, line 88-90).
`design/app-3-portalis.md:238` asks for it ("also grep the app's `.next` server
log capture"). Unlike the sweep above this one is silent — no warning is logged
— and it is a straight one-line harness fix: the run already knows the path, it
prints it as `[oracle] server log: /tmp/oracle-server-$$.log`.

### Everything else

No other suite defects. Every one of the other 17 probes detected exactly the
hole it claims to, and all four non-probe regressions traced to a named defect.
