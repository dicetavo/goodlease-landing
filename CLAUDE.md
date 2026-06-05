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

- **`src/config.ts`** is the single source of truth for company identity (mentions légales), the 6
  `@goodlease.fr` email addresses, the canonical `routes`, nav/footer, and `stores` (App Store / Play
  Store URLs). Edit data here, not in each page.
- **Design = the Flutter app.** Tokens in `tailwind.config.mjs` mirror `../good-lease/lib/styles/colors/
  custom_colors.dart` — primary `#1675F3`, button radius `13px`, Inter font (self-hosted via
  `@fontsource-variable/inter`). `src/components/Logo.astro` pairs `public/mark.svg` (the "G" glyph
  extracted from the brand SVG) with an Inter wordmark. Keep new UI consistent with these tokens.
- **Layouts**: `src/layouts/Base.astro` (SEO head per page — title/description/canonical/OG/Twitter +
  schema.org, set `site:` in `astro.config.mjs`) and `src/layouts/Legal.astro` (legal/help page shell,
  `prose-gl` styling, optional `draftNote` banner).
- **Forms** (`WaitlistForm`, `ContactForm`) POST to **Cloudflare Pages Functions** in
  `functions/api/{waitlist,contact}.ts`, which relay to **Brevo**. Without the Brevo env vars they run in
  **demo mode** (200, no send). ⚠ Pages Functions only run on **Cloudflare Pages** — they do NOT work
  under `npm run dev`/`preview` (forms will fail locally) and would NOT work if the project were a
  Worker. Config them in the Pages dashboard → Settings → Environment variables.
- **Store badges** (`StoreBadges.astro`): hand-built inline-SVG App Store / Play Store badges. They show
  a **"Bientôt disponible"** state and are non-clickable until `stores.appStore`/`stores.playStore` are
  set in `config.ts`. Before launch, swap in the official Apple/Google assets (brand-guideline reasons).
- **Screenshots**: `public/screenshots/*.png` are **real app captures** (downscaled to 640px). Source
  masters live in `src/assets/screenshots/`. **These are public** — never include user PII (the app's
  product-detail screen shows the lender's email and the wallet/transactions screens show balances/emails;
  use only browse, product-top, map, and calendar screens).

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
- `goodlease.fr` + `www` are Pages **Custom domains** → CNAME (proxied) to `goodlease-landing.pages.dev`.
  `www → apex` is a **Cloudflare Redirect Rule** (301), not an Astro `_redirects` file (Pages `_redirects`
  is path-only and ignores hostnames). `api.goodlease.fr` is an unrelated record kept **DNS-only**.

## Conventions

- All user-facing copy is **French**, equipment-rental domain (avoid travel/hotel wording).
- Money is shown as `12,50 €` style. Don't reintroduce the old "GoodLease — Click and Reserve" red logo;
  current brand is the blue `#1675F3` "G" mark.
