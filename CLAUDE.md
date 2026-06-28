# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Public website + landing page for **goodlease.fr** — the marketing site for the **GoodLease** mobile
app (a peer-to-peer equipment-rental marketplace, Flutter, sibling repo at `../good-lease`). The site
has two jobs: (a) a product landing page, and (b) **host every legal/help page the Flutter app links
to**. It is a **static Astro 5 + Tailwind** site deployed to **Cloudflare Pages**.

## Commands

```bash
npm install
npm run dev        # local dev server, http://localhost:4321 (hot reload)
npm run build      # static build → dist/  (⚠ see "flaky build" below)
npm run preview    # serve the built dist/

# Deploy to Cloudflare Pages (Direct Upload — auth read from .cloudflare.env)
set -a; . ./.cloudflare.env; set +a
npx wrangler pages deploy dist --project-name=goodlease-landing --branch=main --commit-dirty=true
```

- **Flaky build**: `astro build` occasionally crashes with a native assertion
  (`BuilderBase.h … block_for_offset`, exit 134/non-zero) — it is **non-deterministic**, not a code
  error. **Just re-run `npm run build`**; it passes on the next try.
- **`.cloudflare.env`** (gitignored) holds `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
  (`9eced5d3235e032982dc03d32b7c7395`). The token only has **Cloudflare Pages: Edit** + **User Details:
  Read** — it **cannot** edit DNS or zone rules (those are done in the Cloudflare dashboard by hand).

## Hard constraint: slugs must match the Flutter app

The app opens `https://goodlease.fr/<slug>` in an external browser. The canonical list of slugs lives in
the **app's** `../good-lease/lib/utils/web_links.dart` (NOT this repo, and NOT the nicer slugs in the
original brief). **Renaming a page = breaking a live link in the shipped app.** The pages that MUST exist:
`/contact`, `/faq`, `/securite`, `/resolution-des-litiges`, `/confidentialite`, `/mentions-legales`,
`/regles-de-contenu`, `/supprimer-mon-compte` (the 8 app slugs) + `/cgs` and `/cookies` (footer-only).

Astro emits `/<slug>/index.html`, so `/<slug>` returns a **308 → `/<slug>/`** then 200. That is expected;
browsers and the app's `launchUrl` follow it.

## Architecture

- **`src/config.ts`** is the single source of truth for company identity (mentions légales), the
  `@goodlease.fr` email addresses (`emails`), the canonical `routes`, nav/footer, `stores` (App Store /
  Play Store URLs), and `analytics` (`plausibleDomain` — empty string = analytics **off**, no script
  loaded; set the domain to enable cookieless Plausible, no consent banner needed). Edit data here, not
  in each page.
- **Design = the Flutter app.** Tokens in `tailwind.config.mjs` mirror `../good-lease/lib/styles/colors/
  custom_colors.dart` — primary `#1675F3`, button radius `13px`, Inter font (self-hosted via
  `@fontsource-variable/inter`). `src/components/Logo.astro` pairs `public/mark.svg` (the "G" glyph
  extracted from the brand SVG) with an Inter wordmark. Keep new UI consistent with these tokens.
- **Layouts**: `src/layouts/Base.astro` (SEO head per page — title/description/canonical/OG/Twitter +
  schema.org, set `site:` in `astro.config.mjs`; also wires the full favicon set + conditional Plausible
  script) and `src/layouts/Legal.astro` (legal/help page shell, `prose-gl` styling, optional `draftNote`
  banner).
- **Favicons** live in `public/` (`favicon.ico`, `favicon.svg`, `favicon-16/32.png`, `apple-touch-icon.png`,
  `icon-192/512.png`, `site.webmanifest`), referenced in `Base.astro`'s `<head>`. Regenerate the PNG sizes
  from `public/icon-1024.png` with `sips -z <px> <px>`; **hand-pack** `favicon.ico` from the 16/32/48 PNGs
  (the `png-to-ico` npm tool injects a ~270 KB 256px BMP entry — avoid it; a PNG-embedded ICO is ~6 KB).
- **Forms** (`WaitlistForm`, `ContactForm`) POST to **Cloudflare Pages Functions** in
  `functions/api/{waitlist,contact}.ts`, which relay to **Brevo**. Without the Brevo env vars they run in
  **demo mode** (200, no send). The waitlist has three modes by config: **double opt-in** (when
  `BREVO_DOI_TEMPLATE_ID` + `BREVO_DOI_REDIRECT_URL` are set — Brevo sends a confirmation e-mail) →
  **single opt-in** fallback (direct list add) → demo. Env vars: `BREVO_API_KEY`,
  `BREVO_WAITLIST_LIST_ID`, `BREVO_NEWSLETTER_LIST_ID`, `BREVO_DOI_TEMPLATE_ID`, `BREVO_DOI_REDIRECT_URL`,
  `CONTACT_TO`, `CONTACT_FROM`. **Don't loosen the error handling**: on the DOI path a Brevo `400` is
  *not* a success (a bad template/list would silently drop signups); only the documented duplicate is
  swallowed, and on the single-opt-in path only. ⚠ Pages Functions only run on **Cloudflare Pages** —
  they do NOT work under `npm run dev`/`preview` (forms fail locally) and would NOT work if the project
  were a Worker. Config them in the Pages dashboard → Settings → Environment variables.
  - **⚠ wrangler clobbers `plain_text` env vars.** `wrangler pages deploy` (Direct Upload) **wipes the
    project's `plain_text` env vars on every deploy** but preserves `secret_text` ones (it can't read
    those). So **ALL of these vars are stored as `secret_text`** — even the non-secret list IDs and
    e-mails — otherwise the next `npm run build && deploy` silently drops them and the forms fall back to
    demo mode (waitlist `queued:false`, contact rejected). Env-var changes also need a **fresh deploy** to
    bind (they don't apply to an existing deployment at runtime; Direct-Upload deployments can't be
    "retried", so re-deploy via wrangler). Set them via the Pages dashboard or the project PATCH API
    (`PATCH …/pages/projects/goodlease-landing`, `deployment_configs.production.env_vars`).
  - **Live as of 2026-06-29** (Brevo free plan, sender `gregorypounah@gmail.com`): waitlist list **ID 3**,
    newsletter list **ID 4**, sender **`contact@goodlease.fr`** (validated via domain auth). Currently
    **single opt-in** — the two `BREVO_DOI_*` vars are unset (no DOI template created yet).
- **Store badges** (`StoreBadges.astro`): hand-built inline-SVG App Store / Play Store badges. They show
  a **"Bientôt disponible"** state and are non-clickable until `stores.appStore`/`stores.playStore` are
  set in `config.ts`. Before launch, swap in the official Apple/Google assets (brand-guideline reasons).
- **Screenshots**: **real app captures**, masters in `src/assets/screenshots/*.png` (1206×2622).
  `PhoneMockup.astro` takes an `image` prop and runs them through **`astro:assets` `<Image format="webp">`**
  (640px-wide WebP generated at build into `_astro/` — no hand-downscaling, no `public/screenshots/`
  copies). Imported & passed in `src/pages/index.astro`. **These ship publicly** — never include user PII
  (the app's product-detail screen shows the lender's email and the wallet/transactions screens show
  balances/emails; use only browse, product-top, map, and calendar screens).

## Legal content status (don't present as final)

- `/mentions-legales`: content from the project brief. **SIREN + N° TVA are `[À COMPLÉTER]` placeholders**
  pending the Kbis — fill `company.siren`/`company.tva` in `config.ts` when received.
- `/cgs` and `/confidentialite`: transcribed from the lawyer's `.docx`, **pending final lawyer
  validation** (both carry a `draftNote`). Corrections already applied to CGS: removed the (closed) EU
  ODR platform reference, fixed "le Prêteur → le Locataire" for rétractation, harmonised CGS/CGU.
- FEVAD mediation clause is conditioned on confirming GoodLease's FEVAD membership.

## Deployment & DNS (Cloudflare Pages, email on OVH)

- Live on **Cloudflare Pages** project `goodlease-landing` (also reachable at `goodlease-landing.pages.dev`).
  The GitHub repo `dicetavo/goodlease-landing` is the source of truth; current deploys are **CLI Direct
  Upload** (the dashboard can also be connected for Git auto-deploy).
- **DNS for `goodlease.fr` is on Cloudflare** (nameservers moved from OVH), but **email stays at OVH**.
  The MX records (`mx1/mx2/mx3.mail.ovh.net`) and the SPF TXT (`v=spf1 include:mx.ovh.com -all`) must
  remain **DNS-only** and untouched — deleting/proxying them breaks mail.
- **OVH email = free MX Plan → redirections only, no mailboxes** ("You cannot create an email account").
  `support@goodlease.fr` and `contact@goodlease.fr` are **redirections → `gregorypounah@gmail.com`** (OVH
  Manager → Emails → Manage redirections). An empty **Email Pro** service also exists but is unused (it
  would require associating the domain + swapping the MX in Cloudflare). To send *as* a branded address
  you'd need a real mailbox (Email Pro); redirections only *receive*.
- **Brevo sending is domain-authenticated** (added in Cloudflare DNS, all **DNS-only**): two DKIM CNAMEs
  `brevo1/brevo2._domainkey` → `b1/b2.goodlease-fr.dkim.brevo.com`, a `brevo-code:…` TXT at apex (`@`),
  and a `_dmarc` TXT (`v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`). These authenticate Brevo's
  outbound mail (DKIM+DMARC) and auto-validate the sender — they do **not** touch the OVH MX/SPF above.
- `goodlease.fr` + `www` are Pages **Custom domains** → CNAME (proxied) to `goodlease-landing.pages.dev`.
  `www → apex` is a **Cloudflare Redirect Rule** (301), not an Astro `_redirects` file (Pages `_redirects`
  is path-only and ignores hostnames). `api.goodlease.fr` is an unrelated record kept **DNS-only**.

## Conventions

- All user-facing copy is **French**, equipment-rental domain (avoid travel/hotel wording).
- Money is shown as `12,50 €` style. Don't reintroduce the old "GoodLease — Click and Reserve" red logo;
  current brand is the blue `#1675F3` "G" mark.
