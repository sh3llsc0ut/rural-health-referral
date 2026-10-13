# Data model (frontend, v2)

These are the record shapes used by `data.js`. When we build the Django backend,
each one becomes a model (database table), and each `Data.*` function becomes an
API call.

Rules we follow everywhere:
- `id` is a unique string (a UUID in the browser; the database will assign it later).
- Dates are ISO 8601 strings, e.g. `2026-10-08T14:30:00.000Z`. Screens format them for display.
- Measurements are a number or `null` (never `0` for "not measured").
- Urgency is always one of `"HIGH"`, `"MEDIUM"`, `"LOW"`.

## Assessment  →  Django models `Patient` + `Assessment` (later split)

| Field | Type | Notes |
|---|---|---|
| id | string | |
| patientCode | string | what the worker typed, e.g. PAT-001 |
| age | number | |
| sex | string | Female / Male / Other |
| symptoms | string[] | |
| needs | string[] | accessibility and communication needs |
| vitals | object | `{ temperature, heartRate, oxygenSaturation }`, each number or null |
| aiUrgency | string | from `Rules.assess()` |
| score | number | |
| reasons | `{text, pts}[]` | why the rules gave that result |
| missing | string[] | measurements not taken |
| review | object or null | `{ decision, reason, finalUrgency, reviewedAt }` |
| createdAt | ISO string | |

## Referral  →  Django model `Referral`

| Field | Type | Notes |
|---|---|---|
| id | string | |
| code | string | readable, e.g. REF-000001 |
| patientCode | string | |
| assessmentId | string | links to the Assessment |
| urgency | string | final urgency after human review |
| aiUrgency | string | what the rules suggested |
| needs | string[] | copied from the assessment |
| hospitalId | number | links to a Hospital |
| service | string | |
| status | string | Created, Saved offline (pending sync), ... |
| createdAt | ISO string | |
| syncedAt | ISO string, optional | set when an offline referral is sent |

## Hospital  →  Django model `Hospital`

`{ id, name, location, services[] }` (mock data in `hospitals.js`).

## Feedback  →  Django model `Feedback`

`{ id, role, ease, text, createdAt }`

## Function to API mapping (planned)

| Frontend call | Future API |
|---|---|
| `Data.listHospitals()` | `GET /api/hospitals/` |
| `Data.createAssessment(x)` | `POST /api/assessments/` |
| `Data.reviewAssessment(id, x)` | `PATCH /api/assessments/{id}/review/` |
| `Data.createReferral(x)` | `POST /api/referrals/` |
| `Data.queueReferral(x)` / `Data.syncOutbox()` | stored locally, then `POST /api/referrals/` for each |
| `Data.listReferrals()` | `GET /api/referrals/` |
| `Data.addFeedback(x)` | `POST /api/feedback/` |
| `Data.setCurrentUser(x)` | `POST /api/auth/login/` |

## Known simplifications (fix with the backend)

- Patient details are inside Assessment; the backend will have a separate Patient table.
- The current user lives in memory only; real login needs the backend.
- The urgency rules in `rules.js` move to the server, so the rules cannot be changed from the browser.

---

# Added in Step 2a: accounts and facilities

## User  →  Django model `User` (extend Django's built-in user)

| Field | Type | Notes |
|---|---|---|
| id | string | |
| username | string | unique, lowercase |
| fullName | string | |
| role | string | `Healthcare Worker`, `Referral Hospital` or `Administrator`. Chosen by the server, never by the registration form |
| cadre | string | Community Health Worker, Nurse, Clinical Officer, Doctor, Other health worker |
| licence | string | optional, cannot be verified without a backend |
| phone | string | normalised to `+254...` |
| facilityId | number or null | where the user works. Null for administrators |
| passwordSalt, passwordHash | string | PBKDF2 hash (the frontend never stores the plain password). Django handles this itself later |
| createdAt | ISO string | |

## Facility  →  Django model `Facility`

`{ id, name, location, level (2-6), receivesReferrals, services[] }`.
A facility cannot refer a patient to itself, and only facilities with `receivesReferrals: true` can be chosen as the destination.

## Fields added to existing records

- Assessment: `facilityId` (where it was recorded), `createdBy` (user id)
- Review: `reviewedBy` (user id)
- Referral: `fromFacilityId`, `createdBy`

These come from the signed-in account inside `data.js`, never from the form. On the real server they will come from the authenticated user.

## Function to API mapping (additions)

| Frontend call | Future API |
|---|---|
| `Data.registerUser(x)` | `POST /api/auth/register/` |
| `Data.login(u, p)` | `POST /api/auth/login/` |
| `Data.logout()` | `POST /api/auth/logout/` |
| `Data.listFacilities()` | `GET /api/facilities/` |

## Known simplifications (fix with the backend)

- Accounts live in one browser. A real server shares them across devices and enforces uniqueness for everyone.
- Passwords are hashed, but anyone with access to the browser's storage can still try to guess them offline. Real login needs server-side protection (rate limiting, lockout, HTTPS-only sessions, email or SMS verification, password reset).
- Demo accounts have a known password and exist only for the presentation. Remove them before real use.
- Every signed-in user can currently see all records on the device. Role-based visibility is the next step.

---

# Added in Step 2b: roles and the referral workflow

## Who can see and do what (enforced in `data.js`, the future server)

| Role | Sees | Can do |
|---|---|---|
| Healthcare Worker | assessments and referrals from their own facility, their own offline outbox | record patients, review recommendations, create referrals, synchronize |
| Referral Hospital | referrals sent to their own facility (with the clinical summary) | accept or reject, mark arrival, complete with an outcome |
| Administrator | all referrals and dashboard totals, feedback | read-only oversight (no patient assessments) |

The menu only hides screens. The real protection is that `data.js` refuses the action. In Django this becomes permission classes and filtered querysets.

## Referral (changes)

| Field | Type | Notes |
|---|---|---|
| status | string | `Created`, `Accepted`, `Rejected`, `Patient arrived`, `Did not arrive`, `Completed` (and `Saved offline (pending sync)` before sending) |
| outcome | string, optional | set when `Completed`: Treated and discharged, Admitted, Referred onward |
| summary | object | snapshot taken when the referral is created: age, sex, symptoms, vitals, reasons, missing, review decision and reason |
| history | array | `{ status, at, by, byName, note }` for every change |

The urgency, patient code, needs and summary are worked out by the server side from the reviewed assessment. The form only chooses the hospital and service.

## Status workflow (`Rules.REFERRAL_FLOW`)

```
Created ──accept──► Accepted ──arrived──► Patient arrived ──► Completed
   │                    └──no-show──► Did not arrive
   └──reject (reason required)──► Rejected
```

## Function to API mapping (additions)

| Frontend call | Future API |
|---|---|
| `Data.updateReferralStatus(id, action, note)` | `POST /api/referrals/{id}/actions/` |
| `Data.getStats()` | `GET /api/stats/` |
