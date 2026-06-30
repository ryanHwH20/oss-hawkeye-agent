<p align="center">
  <img src="assets/banner.svg" alt="Hawkeye" width="100%">
</p>

# Hawkeye — Brand Guideline

The visual identity system for Hawkeye. Built in the Google / Material design
language: light surfaces, generous whitespace, a confident blue primary, and the
four Google accent colours used with intent. Everything ships as scalable SVG so
it stays crisp from a 16&nbsp;px favicon to a conference banner.

---

## 1. Brand essence

| | |
|---|---|
| **Name** | **Hawkeye** — after the Hawk-Eye officiating system that delivers indisputable, millimetre-accurate in/out calls. |
| **One-liner** | The high-precision line-judge for your software supply chain. |
| **Tagline** | *Every install, called.* |
| **Personality** | Authoritative, precise, fast, calm. Clean and friendly, never alarmist or noisy. |
| **What the logo says** | A targeting **reticle** fused with a **watchful eye** — constant watch + a precise verdict on every package. The four cardinal ticks carry the four Google colours, nodding from *watch* to *verdict*. |

---

## 2. Logo

### The mark
A line-call **reticle** (ring + four cardinal ticks) wrapping an **iris and pupil**.
It reads as both *a scope taking aim* and *an eye that never blinks*. The ring,
iris and pupil are Google Blue; the four ticks are blue / red / yellow / green.

### Assets

| File | Use |
|---|---|
| [`assets/logo-mark.svg`](assets/logo-mark.svg) | Icon only, transparent background. App icons, inline marks, favicon source. |
| [`assets/logo-tile.svg`](assets/logo-tile.svg) | Mark on a white Material tile. Avatars, GitHub org icon. |
| [`assets/logo-horizontal-dark.svg`](assets/logo-horizontal-dark.svg) | Horizontal lockup for **dark** backgrounds. |
| [`assets/logo-horizontal-light.svg`](assets/logo-horizontal-light.svg) | Horizontal lockup for **light** backgrounds. |
| [`assets/banner.svg`](assets/banner.svg) | README / docs hero (1280×320). |
| [`assets/social-preview.svg`](assets/social-preview.svg) · [`.png`](assets/social-preview.png) | GitHub social preview / Open Graph card (1280×640). Upload the PNG in **Settings → Social preview**. |

### Clearspace & minimum size
- **Clearspace:** keep free space of at least one reticle-tick length on every side of the mark and the full lockup.
- **Minimum size:** mark ≥ 24&nbsp;px; horizontal lockup ≥ 120&nbsp;px wide. Below that, prefer the mark alone.

### Don't
- ❌ Recolour the mark's ring/iris outside Google Blue, or restyle the four tick colours.
- ❌ Stretch, skew, rotate, or add heavy drop shadows / glows.
- ❌ Put the blue mark on a saturated or low-contrast background; use the white tile.
- ❌ Re-letter the wordmark in another typeface, or set "eye" in a non-blue colour.

---

## 3. Colour

Light, Material, blue-led. The four Google colours appear in the mark; the
traffic-light verdict colours are **reserved for status** and never used as decoration.

### Core

| Token | Hex | Role |
|---|---|---|
| `--blue` | `#1A73E8` | Primary — the mark, links, CTAs, "eye" |
| `--blue-bright` | `#4285F4` | Gradient highlight, blue tick |
| `--blue-on-dark` | `#8AB4F8` | Primary on dark surfaces |
| `--ink` | `#202124` | Headings & wordmark on light |
| `--grey` | `#5F6368` | Secondary / muted text |
| `--surface` | `#FFFFFF` | Primary background |
| `--surface-alt` | `#F8F9FA` | Panels, cards |
| `--border` | `#DADCE0` | Tile / control borders |
| `--hairline` | `#E8EAED` | Dividers |
| `--paper` | `#E8EAED` | Headings & wordmark on dark |

The mark's iris uses a blue gradient: `#4285F4 → #1A73E8`.

### Verdict signal system (status only)

| Verdict | Dot | Chip fill | Meaning |
|---|---|---|---|
| 🟢 **SAFE** | `#34A853` | `#E6F4EA` | Cleared — exit 0 |
| 🟡 **UNKNOWN** | `#F9AB00` | `#FEF7E0` | Could not verify — fail closed, exit 2 |
| 🔴 **BLOCKED** | `#EA4335` | `#FCE8E6` | Out of bounds — exit 1 |

> These are Google's standard status colours and light tints, so the verdict chips
> read instantly to anyone fluent in Material.

---

## 4. Typography

| Role | Typeface | Treatment |
|---|---|---|
| Wordmark / display | **Google Sans** / Product Sans (fallback: Roboto → system-ui) | 700 weight, sentence case "Hawkeye". "Hawk" in ink, "eye" in blue. |
| Headings & UI | Google Sans / Roboto / system-ui | 500–700 |
| Body | Roboto / system-ui stack | 400 |
| Labels / chips | system stack, UPPERCASE | 600, light letter-spacing |

SVG assets reference a font stack rather than embedding a font, so they render with
Google Sans where present and degrade gracefully to Roboto / system-ui.

---

## 5. Using the assets

**README hero**
```html
<p align="center">
  <img src="assets/banner.svg" alt="Hawkeye" width="100%">
</p>
```

**Theme-aware horizontal lockup** (GitHub light/dark)
```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-horizontal-dark.svg">
  <img src="assets/logo-horizontal-light.svg" alt="Hawkeye" width="320">
</picture>
```

**Regenerate the raster social card** (needs `librsvg`)
```bash
rsvg-convert assets/social-preview.svg -o assets/social-preview.png
```

---

*Hawkeye visual identity — keep it precise.*
