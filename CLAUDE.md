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
- **No lint / tests / typecheck** are configured (`dev`/`build`/`preview` are the only npm scripts) —
  a passing `npm run build` is the verification gate, plus grepping `dist/` for the expected output.
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
browsers and the app's `launchUrl` follow it. Path-only redirects live in **`public/_redirects`**
(currently `/conditions-generales` → `/cgs/` 301). Pages also 308-redirects any `*.html` URL to its
extensionless path ("pretty URLs") — a file dropped in `public/` is never served at its literal `.html` URL.

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
  schema.org; canonical URLs come from `site: 'https://goodlease.fr'` in `astro.config.mjs`, which also
  feeds `@astrojs/sitemap` → `sitemap-index.xml`, referenced by `public/robots.txt`; Base also wires the
  full favicon set + conditional Plausible
  script) and `src/layouts/Legal.astro` (legal/help page shell, `prose-gl` styling, optional `draftNote`
  banner).
- **`src/pages/404.astro` must exist**: on Cloudflare Pages a static site returns a **soft-404** (200 +
  homepage content) for unknown paths unless the build emits a `404.html`. Don't delete this page — it's
  what makes real 404s (and correct SEO) work.
- **Landing page (`src/pages/index.astro`)** is one long page composed of inline `<section>`s plus a few
  section components, with a deliberate **light/dark rhythm** (light `canvas`/`surface` sections alternating
  with `bg-ink` dark ones — e.g. `ThreeScene` and the "Sécurité" section). Two cross-cutting systems:
  - **Scroll-reveal**: add `data-reveal` (and optional `style="--reveal-delay:Nms"`) to any element — an
    IntersectionObserver in `Base.astro` toggles `.is-visible`; the hidden/visible/`prefers-reduced-motion`
    styles live in `global.css` (`@layer base`, gated on `html.js`). Match this on new sections.
  - **`ThreeScene.astro`** (dark WebGL section): **dynamically `import('three')`** so three is code-split
    out of the main bundle, and only starts rendering when scrolled into view; it **no-ops** under
    `prefers-reduced-motion` or Save-Data. Keep three lazy — never static-import it.
  - **`AppJourney.astro`**: data-driven "full app journey" section (tracks → phases → steps + transversal
    items); edit the arrays at the top, icons inlined via `set:html`.
  - **UI primitives**: reusable classes (`.btn`/`.btn-primary`, `.eyebrow`, `.container-gl`) are defined in
    `global.css` `@layer components` — use them for new sections instead of re-styling from scratch.
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
- **Store badges** (`StoreBadges.astro`): hand-built inline-SVG App Store / Play Store badges. A badge is
  non-clickable until its URL is set in `config.ts` `stores`; the pill under them adapts («Bientôt
  disponible» / «Bientôt sur Google Play» / «Bientôt sur l'App Store»). **Both apps are LIVE** — iOS
  since 2026-07-20 (« Good Lease : Location Matériel », `apps.apple.com/fr/app/...id6758953661`), Android
  since 2026-07-24 (`play.google.com/store/apps/details?id=com.goodlease.app`); both URLs are in
  `config.ts` `stores` (badges clickable, no pill) and in the home schema.org `installUrl` array. The
  former Android-launch waitlist is reframed as a product-news signup («Recevez les nouveautés de l'app
  par e-mail», button « S'inscrire ») — backend unchanged (Brevo waitlist list 3 + optional newsletter
  list 4). Still TODO: swap in the official Apple/Google badge assets (brand-guideline reasons) — the Apple
  marketing-tools SVG endpoints aren't fetchable by CLI (404), download manually from
  https://developer.apple.com/app-store/marketing/guidelines/.
- **Product visuals — code-built illustrations preferred over screenshots.** `PhoneMockup.astro` renders a
  phone frame around **either** an optimized image (`image` prop → `astro:assets` `<Image format="webp">`,
  640px WebP into `_astro/`; or raw `src`) **or slotted content** (`Astro.slots.has('default')`) — an
  on-brand fake app screen built in code. The illustrated system: `ListingCard.astro` (annonce card:
  crisp FR text, Pro badge, price/jour; visual = **AI-generated catalog photo** via the `image` prop —
  masters in `src/assets/annonces/*.png`, generated with Higgsfield `marketing_studio_image` (4:3, light-
  grey studio style, prompts in the git history) through the higgsfield MCP server; without `image` it
  falls back to a brand-gradient tile + equipment icon) and `ExplorerScreen.astro` (a full "Explorer"
  feed screen slotted into the hero phone). The hero and the "Annonces" section use these — **prefer
  them for new product UI** (no PII, fully on-brand, localizable). Keep new annonce photos in the same
  consistent catalog style (clean bright light-grey seamless studio background, no people/text/logos).
- **Real captures** still exist (masters in `src/assets/screenshots/*.png`, 1206×2622) and are still used in
  a couple of sections (e.g. "Pour les loueurs"), also via `astro:assets` WebP — no `public/screenshots/`
  copies. **These ship publicly** — never include user PII (the app's product-detail screen shows the
  lender's email and the wallet/transactions screens show balances/emails; use only browse, product-top,
  map, and calendar screens).

## Legal content status

- `/mentions-legales`: content from the project brief. **SIREN + N° TVA are filled** from the Kbis
  (received 2026-07-03; immatriculation RCS Lille Métropole 02/07/2026): SIREN `106 617 467`, TVA
  `FR54 106 617 467` (key derived from SIREN — cross-check against the SIE mémento fiscal when it
  arrives). `company.phone` is empty → the « Téléphone » line is conditionally hidden on
  `/mentions-legales`, `/contact` and `/cgs`; fill it in `config.ts` to show it again.
- `/cgs` and `/confidentialite`: **lawyer-validated** (dated « 18 juin 2026 », `draftNote` banners
  removed). ⚠ Two additions in `/confidentialite` were made *after* the validated `.docx` (« Transferts
  hors UE » Stripe/Google + retention 10 y compta / 5 y KYC) — flag them at the next lawyer pass.
- Consumer mediator is **CM2C** (named in CGS §18 and `/resolution-des-litiges`) — it replaced FEVAD
  (too expensive). GoodLease still has to **actually subscribe** with CM2C (art. L612-1) — see SPECS.md.

## Deployment & DNS (Cloudflare Pages, email on OVH)

- Live on **Cloudflare Pages** project `goodlease-landing` (also reachable at `goodlease-landing.pages.dev`).
  The GitHub repo `dicetavo/goodlease-landing` is the source of truth; current deploys are **CLI Direct
  Upload** (the dashboard can also be connected for Git auto-deploy).
- **Preview deploys**: for WIP (e.g. a redesign under review), deploy to a **non-production branch** —
  `wrangler pages deploy dist … --branch=preview-redesign` → served at
  `preview-redesign.goodlease-landing.pages.dev`, leaving prod (`goodlease.fr`, `--branch=main`) untouched.
  Only `--branch=main` updates production.
- **DNS for `goodlease.fr` is on Cloudflare** (nameservers moved from OVH), but **email stays at OVH**.
  The MX records (`mx1/mx2/mx3.mail.ovh.net`) and the SPF TXT (`v=spf1 include:mx.ovh.com -all`) must
  remain **DNS-only** and untouched — deleting/proxying them breaks mail.
- **OVH email = free MX Plan → redirections only, no mailboxes** ("You cannot create an email account").
  `support@goodlease.fr`, `contact@goodlease.fr` and `gregorypounah@goodlease.fr` are **redirections →
  `gregorypounah@gmail.com`** (OVH Manager → Emails → Manage redirections; `gregorypounah@` created
  2026-07-09 as the org-domain e-mail Apple requires for the Apple Developer **Organization** enrollment).
  An empty **Email Pro** service also exists but is unused (it
  would require associating the domain + swapping the MX in Cloudflare). To send *as* a branded address
  you'd need a real mailbox (Email Pro); redirections only *receive*.
- **Brevo sending is domain-authenticated** (added in Cloudflare DNS, all **DNS-only**): two DKIM CNAMEs
  `brevo1/brevo2._domainkey` → `b1/b2.goodlease-fr.dkim.brevo.com`, a `brevo-code:…` TXT at apex (`@`),
  and a `_dmarc` TXT (`v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`). These authenticate Brevo's
  outbound mail (DKIM+DMARC) and auto-validate the sender — they do **not** touch the OVH MX/SPF above.
- `goodlease.fr` + `www` are Pages **Custom domains** → CNAME (proxied) to `goodlease-landing.pages.dev`.
  `www → apex` is a **Cloudflare Redirect Rule** (301), not an Astro `_redirects` file (Pages `_redirects`
  is path-only and ignores hostnames). `api.goodlease.fr` is an unrelated record kept **DNS-only**.
- **Google Search Console**: the URL-prefix property `https://goodlease.fr/` is verified (2026-07-13,
  Google account `gregorypounah@gmail.com`) via the `google-site-verification` **meta tag in
  `Base.astro`** — **never remove it** (Google re-checks periodically; it's the site-ownership proof the
  Google Play Console *organization verification* relies on). The HTML-file method does **not** work on
  this site (Pages 308s `*.html` and Google won't follow redirects for the verification file);
  `public/googlee397a609380dec65.html` is kept anyway as a backup proof (served extensionless).

## Conventions

- **`AGENTS.md` is a manually-synced copy of this file** (for non-Claude agents). Any edit to CLAUDE.md
  must be applied to AGENTS.md too, and vice versa.
- All user-facing copy is **French**, equipment-rental domain (avoid travel/hotel wording).
- **`SPECS.md` is the open-items TODO list** (cleaned 2026-07-22 — done items removed, only genuinely
  open work remains). CLAUDE.md stays authoritative for current status; still re-verify a SPECS box
  before acting on it if some time has passed.
- Money is shown as `12,50 €` style. Don't reintroduce the old "GoodLease — Click and Reserve" red logo;
  current brand is the blue `#1675F3` "G" mark.
