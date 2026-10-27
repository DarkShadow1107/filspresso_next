# NestJS security migration plan and results

**Status (2026-10-27):** the Nest 11 migration and local verification are complete in the
working tree; the backend has **not** been deployed. Nest 11.2.8 was selected instead of Nest
12 because the existing Redis throttler adapter declares support through Nest 11. The current
production and full dependency audits both report **0 findings**. Image build and runtime
smokes passed; staging, live service checks and rollout approval remain outstanding.

The baseline below records evidence from 2026-10-26. Advisory counts can change as the
registry is updated; rerun the audits before release.

## Why the migration is needed

Before the migration, the backend had **11 production audit findings: 5 high and 6 moderate, with no
critical findings**. They are not 11 independent NestJS bugs: several are transitive
packages pulled in by the Express adapter and config/common packages. They nevertheless sit
in the production dependency tree of a network-facing API. The principal risks are request
resource exhaustion/denial of service, unsafe multipart handling, malformed-media parser
loops/decompression bombs, prototype pollution, and a Nest core output-injection issue when
affected output reaches a downstream interpreter.

Pre-migration lockfile versions (2026-10-26):

| Dependency | Version / path at baseline |
| --- | --- |
| `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express` | `10.4.22` |
| `@nestjs/config` | `3.3.0` |
| Express / body-parser | `express@4.22.1` / nested `body-parser@1.20.4` |
| Multer | adapter-nested `2.0.2`; top-level direct `2.5.0` |
| `file-type`, `lodash`, `qs` | `20.4.1`, `4.17.21`, `6.14.2` |
| backend `sharp`, `uuid` | `0.34.5`, `9.0.1` |
| throttler Redis storage | `@nest-lab/throttler-storage-redis@1.2.0` |

The lockfile matters: a patched top-level Multer does not replace the separate vulnerable
Multer nested under the current adapter.

## Findings and remediation disposition

| Finding in the pre-migration production audit | Security significance and implemented disposition |
| --- | --- |
| `@nestjs/core@10.4.22`, moderate; affected through `11.1.17` — [GHSA-36xv-jgw5-4q75](https://github.com/advisories/GHSA-36xv-jgw5-4q75) | Improper neutralization of special elements in output consumed by a downstream component. The aligned core packages now resolve to `11.2.8`; the post-migration audit reports no production findings. Do not describe this as a general remote-code-execution finding. |
| `@nestjs/platform-express@10.4.22` and `body-parser@1.20.4`, high — [GHSA-v422-hmwv-36x6](https://github.com/advisories/GHSA-v422-hmwv-36x6), [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | Request denial of service involving invalid body limits and trailing bytes after compressed bodies. The Nest 11 adapter now resolves Express `5.2.1` and body-parser `2.4.0`; Express 5 tests cover JSON size rejection, gzip, urlencoded nested fields and query behavior. |
| `@nestjs/common@10.4.22` through `file-type@20.4.1`, moderate — [GHSA-5v7r-6r5c-r473](https://github.com/advisories/GHSA-5v7r-6r5c-r473), [GHSA-j47w-4g3g-c36v](https://github.com/advisories/GHSA-j47w-4g3g-c36v) | Malformed ASF input can loop; a crafted ZIP can cause decompression-bomb resource use. The lockfile now resolves `file-type@21.3.4` under `@nestjs/common@11.2.8`; the production audit is clean. |
| `@nestjs/config@3.3.0` through `lodash@4.17.21`, moderate/high — [GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc), [GHSA-f23m-r3pf-42rh](https://github.com/advisories/GHSA-f23m-r3pf-42rh), [GHSA-xxjr-mmjv-4gpg](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg) | Lodash advisories cover template code injection and prototype pollution in `unset`/`omit`. Nest config now resolves to `4.0.4` with patched `lodash@4.18.1`; a mounted ConfigModule test verifies custom config, Joi validation and environment values. |
| `multer` in the Express adapter, high; pre-migration adapter resolved `2.0.2` | Multipart denial-of-service/resource-exhaustion issues include malformed/deep field names, abort cleanup and an asynchronous `fileFilter` race that can bypass file-size limits. Relevant advisories include [GHSA-72gw-mp4g-v24j](https://github.com/advisories/GHSA-72gw-mp4g-v24j), [GHSA-3p4h-7m6x-2hcm](https://github.com/advisories/GHSA-3p4h-7m6x-2hcm), [GHSA-qvfw-j98x-7q72](https://github.com/advisories/GHSA-qvfw-j98x-7q72), [GHSA-535w-7cp7-47q4](https://github.com/advisories/GHSA-535w-7cp7-47q4), and [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m). Nest 11.2.8 pins Multer `2.4.0`; a root npm override forces the adapter and direct dependency to `2.5.0`. `npm ls` confirms deduplication, and multipart ordering has regression coverage. |
| `qs@6.14.2`, moderate — [GHSA-q8mj-m7cp-5q26](https://github.com/advisories/GHSA-q8mj-m7cp-5q26), [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) | Denial-of-service and array-limit parsing issues. The Express 5 lockfile resolves `qs@6.17.0`; parser tests verify nested form and repeated query values. |
| Backend `sharp@0.34.5`, high — [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), [GHSA-g89c-p67h-r497](https://github.com/advisories/GHSA-g89c-p67h-r497), [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c), [GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) | Vulnerable libvips/libheif/librsvg dependencies in image processing. Backend Sharp now resolves to `0.35.5`; the production image built on Node `20.20.2` and successfully processed a generated PNG. |
| Backend `uuid@9.0.1`, moderate — [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Missing buffer bounds checks affect v3/v5/v6 when a caller supplies `buf`. The application imports v4 only; the dependency is now `uuid@11.1.1`, which provides CommonJS and ESM entry points. |

The audit also reports `@nestjs/common`, `@nestjs/config` and the platform adapter as
vulnerable package records because of these transitive dependencies. The numbers above are
package-level audit entries, not a count of unique attack paths. A successful migration must
re-run the audit and inspect `npm ls`; changing the Nest major alone does not establish that
the full dependency tree is fixed.

## Application-specific upload risk and remediation

Before the migration, `upload/coffee-image` ran `FileInterceptor` with disk storage before
`uploadImage()` called `authenticateAdmin()`, allowing unauthenticated multipart parsing before
the admin check. The route now has `AdminUploadAuthGuard`; it delegates to
`AdminService.requireAdmin()` and executes before the interceptor. The existing service is
still attached to the request for the storage callbacks, and the original admin session checks
remain in place. Regression tests verify the production route has the guard, unauthenticated
requests do not invoke Multer's file filter, and authenticated requests reach the interceptor.
The guard delegation itself is tested. Full expired-session/disk-residue tests against a live
database-backed admin account remain part of staging qualification.

`PlaygroundContextController` retains its class-level JWT guard and 20 MiB/one-file Multer
limit.

## Implemented compatibility changes

- Aligned `@nestjs/common`, `@nestjs/core` and `@nestjs/platform-express` on `11.2.8`; upgraded
  `@nestjs/config` to `4.0.4` and retained `@nestjs/throttler@6.7.1`.
- Kept `@nest-lab/throttler-storage-redis@1.2.0` without peer overrides: its declared Nest
  peer range includes v11. The existing `ResilientThrottlerStorage` remains wired, and the
  fallback, bounded delegate wait, block and recovery tests pass.
- Moved to Express `5.2.1`, body-parser `2.4.0`, `qs@6.17.0` and `@types/express@5.0.6`.
  The pinned backend image runs Node `20.20.2`, satisfying Nest and Sharp runtime floors.
- Added direct Multer `2.5.0` and a matching npm override because the Nest adapter still pins
  `2.4.0`; `npm ls` confirms both the adapter and app resolve `2.5.0`.
- Updated backend Sharp to `0.35.5` and UUID to `11.1.1`.
- Replaced the unsupported inline-regex account paths with named parameters and
  `ParseIntPipe`; the fixed `/preferences` route is registered before `/:id`. Tests cover
  numeric IDs, invalid IDs, subscription and preference routes.
- Added Express 5 request-parser tests for bounded JSON, gzip, nested urlencoded input,
  repeated/default query values and a `413` size rejection. Added a Config v4 module test for
  custom configuration and Joi-validated environment values.

The route and parser tests do not constitute a live staging pass. Full service startup against
PostgreSQL/Redis, proxy/cookie/CORS smoke tests, and multipart filesystem checks remain
outstanding before deployment.

## Staged implementation and validation results

1. **Baseline:** the 2026-10-26 lockfile, Node image and 11 production audit findings were
   recorded above.
2. **Upload ordering:** the pre-interceptor guard and unit/integration coverage are implemented.
3. **Peer compatibility:** Nest 11 was selected specifically to retain the Redis adapter's
   declared peer compatibility; no `--force` or peer override was used.
4. **Dependency and route migration:** the backend lockfile resolves to the versions listed
   above, and the affected advisories have been re-audited.
5. **Automated verification:** after a clean `npm ci`, all **362/362** backend tests pass;
   `typecheck`, `typecheck:agent-integration` and production TypeScript build pass. Both
   `npm audit --omit=dev` and full `npm audit` report **0 findings**. The Docker backend image
   builds, and a Node 20.20.2 runtime smoke loads Nest's Express adapter/Multer and generates a
   PNG with Sharp. Redis fallback tests use deterministic fixtures; a live Redis outage drill
   was not run as part of this migration.
6. **Staging/rollout:** not performed. The built image has not replaced the running backend.
   Preserve the existing image and lockfile for rollback; do not treat the local build as
   production deployment evidence.
7. **Go/no-go:** no release approval is implied. Staging smoke/monitoring, live DB-backed
   upload checks and explicit approval remain required before deployment.

## Not in scope / current decision

- Nest 12 is not part of this migration. Nest 11.2.8 is the selected compatible security
  target while the existing Redis throttler adapter supports Nest through v11; re-evaluate
  Nest 12 only after that peer dependency changes.
- The frontend Next.js/Sharp work is separate; its audit must not be confused with the backend
  audit.
- The pre-auth upload ordering was an application bug to remediate on its own merits; a Nest
  upgrade alone would not have fixed it.
