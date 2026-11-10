# AGM editor notes

Admin UI for Annual General Meetings, on the `agm-editor` branch of `pu_staging` only. This does not change `meetings.html`. Public meetings will keep using the static `data-agm-*` markup until PU says otherwise.

The editor talks to TEST (`pu2`, `vcugotjdsurpbntuxgcf`) with the existing public anon key in `assets/js/pu-auth.js`. There is no service-role key in the front end.

## Contract (PU Data `agm_v1`, applied on TEST)

Table: `public.agm_meetings`

| Column | Type | Rules |
|--------|------|--------|
| `id` | `bigint` identity PK | Do not send on insert |
| `year` | `int` not null | Required; `CHECK (year between 2000 and 2100)` |
| `title` | `text` not null | Required; cannot be blank (`length(btrim(title)) > 0`) |
| `location` | `text` | Optional |
| `start_date` | `date` | Optional |
| `end_date` | `date` | Optional; must be on or after `start_date` if both are set (`agm_dates_order`) |
| `status` | `text` not null | `next`, `tba`, or `past`; default `tba`. Only **one** row may be `next` (unique index `agm_one_next`) |
| `short_description` | `text` | Optional |
| `published` | `boolean` not null | Default `false` |
| `sort_order` | `int` not null | Default `0` |
| `created_at` | `timestamptz` | Default `now()`. **Never send.** |
| `updated_at` | `timestamptz` | Set by trigger `agm_touch_updated_at`. **Never send.** |

There is **no DELETE** grant or policy. Hide a meeting by setting `published = false`.

### Access

- `anon` and `authenticated` may `SELECT` published rows. Admins (`is_admin()`) can also select drafts.
- Only admins may `INSERT` or `UPDATE`, and only these columns: `year`, `title`, `location`, `start_date`, `end_date`, `status`, `short_description`, `published`, `sort_order`.
- Non-admin writes fail with `42501`, or an update that matches no rows (0 rows). The client treats both as an authorization / not-found error.
- List order in the editor: `sort_order` ascending, then `year` descending (matches index `agm_list_idx`).

### Error codes (branch on `error.code`, not HTTP status)

| Code | Meaning in this editor |
|------|------------------------|
| `42P01` (and PostgREST table-missing codes such as `PGRST205`) | “AGM table not set up on TEST yet” |
| `23505` | “Another AGM is already marked Next. Set it to Past or TBA first.” |
| `23514` | Check constraint failed: year out of range, blank title, or end date before start date |
| `42501` | Not authorized, or the update applied to 0 rows |
| `22023` | Client-side validation (missing year, nothing to update) |

## Front-end layout

All data calls live in `admin/assets/agm-api.js` (`supabase.from('agm_meetings')` CRUD). The UI is `admin/agm.html` + `admin/assets/agm.js`. The page uses the same `is_admin` gate as the other admin screens (`PUAuth.checkIsAdmin`): signed-out users go to Member Area sign-in; signed-in non-admins go to the member home.

The admin nav on Members, Pending edits, Admins and AGM includes an AGM link. The Members page (the admin landing after sign-in) also has a dashboard card that points here.

There is no Delete button. Existing meetings have Publish / Unpublish, with a confirmation, which only flips `published`. New meetings start unpublished. Photo uploads are a “coming later” placeholder.

## What would change if the contract differs later

If PU Data later wraps writes in RPCs (for example `admin_list_agm` / `admin_upsert_agm`), only `admin/assets/agm-api.js` should need to change, plus this note. The form fields and `is_admin` gate can stay.

Other likely diffs and the one-place fix:

- Table or column rename — change `TABLE` / `WRITE_FIELDS` / `COLUMNS` in `agm-api.js`.
- Extra columns (photos, venue URL, “next AGM” announcement copy) — extend the write payload and the form in `agm.html` / `agm.js`.
- Allowed status values or more than one `next` row — update the status `<select>`, the unique-next error copy, and validation.
- List order changes — change the `.order(...)` calls in `listMeetings`.
- Deletes become allowed — add a confirmed delete path; do not assume that without a new contract.
- Public Meetings page starts reading this table — still do not edit `meetings.html` until PU asks; the public hooks already present there are `data-agm-next`, `data-agm-year`, `data-agm-status`, `data-agm-location`, and `data-agm-dates`.

## Out of scope

- `meetings.html` and the `/redesign/` preview
- The LIVE repo (`pu_temp`) and production Supabase
- Pushing or opening a pull request from this branch until Rex approves
