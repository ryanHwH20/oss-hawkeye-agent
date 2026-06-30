<p align="center">
  <img src="assets/banner.svg" alt="Hawkeye" width="100%">
</p>

# Hawkeye — Brand Guideline

The visual identity system for Hawkeye. The direction is **"Centre Court"** —
heritage, precision, and quiet authority, in the spirit of the great officiating
traditions of tennis. A medallion seal stands for *an indisputable call*; deep
grass green, championship gold, and warm paper give it class without noise.
Everything ships as scalable SVG so it stays crisp from a 16&nbsp;px favicon to a
conference banner.

---

## 1. Brand essence

| | |
|---|---|
| **Name** | **Hawkeye** — after the Hawk-Eye officiating system that delivers indisputable, millimetre-accurate in/out calls. |
| **One-liner** | The high-precision line-judge for your software supply chain. |
| **Tagline** | *Every install, called.* |
| **Personality** | Authoritative, precise, composed, heritage-grade. Confident and calm — never loud, never alarmist. |
| **What the logo says** | A **medallion seal** (the authority of a final, indisputable verdict) around a **watchful reticle-eye** (precision + constant watch), with a single gold **focal point** — *the call*. The seal is also our answer to *fail-closed*: authority you can trust to withhold approval. |

---

## 2. Logo

### The mark
A double-ring **medallion** — deep grass green with a fine gold inlay — enclosing a
**reticle-eye**: four cardinal ticks, an iris, and a gold pupil that is *the call*.
It reads as an official seal and a watchful eye at once.

### Assets

| File | Use |
|---|---|
| [`assets/logo-mark.svg`](assets/logo-mark.svg) | Medallion mark, transparent — for **light** backgrounds; favicon source. |
| [`assets/logo-tile.svg`](assets/logo-tile.svg) | Crest tile (cream + gold medallion on forest green). Avatars, GitHub org icon, dark backgrounds. |
| [`assets/logo-horizontal-dark.svg`](assets/logo-horizontal-dark.svg) | Horizontal lockup for **dark** backgrounds. |
| [`assets/logo-horizontal-light.svg`](assets/logo-horizontal-light.svg) | Horizontal lockup for **light** backgrounds. |
| [`assets/banner.svg`](assets/banner.svg) | README / docs hero (1280×320). |
| [`assets/social-preview.svg`](assets/social-preview.svg) · [`.png`](assets/social-preview.png) | GitHub social preview / Open Graph card (1280×640). Upload the PNG in **Settings → Social preview**. |

### Clearspace & minimum size
- **Clearspace:** keep free space of at least one reticle-tick length around the medallion and the full lockup.
- **Minimum size:** medallion ≥ 28&nbsp;px (below this the gold inlay is decorative — the mark still reads); horizontal lockup ≥ 140&nbsp;px wide.
- On dark surfaces use the **crest tile** or the cream medallion (`logo-horizontal-dark`), never the green mark on dark.

### Don't
- ❌ Recolour the medallion green or set the pupil in anything but gold.
- ❌ Swap the serif wordmark for a sans, or stretch / skew / rotate the mark.
- ❌ Add glows or heavy shadows — the texture is paper and gold, not neon.
- ❌ Use the verdict colours (green / amber / red) anywhere in the logo.

---

## 3. Colour

Heritage and composed: **grass green led, gold accent, warm paper ground.** The brand
green is a deep, cool bottle green — kept tonally distinct from the brighter SAFE
status emerald so the traffic-light verdict palette keeps its meaning. Status green /
amber / red are **reserved for verdicts** — never decoration.

### Core

| Token | Hex | Role |
|---|---|---|
| `--green` | `#154734` | Primary — mark, wordmark, headings on light |
| `--green-deep` | `#0F3A2A` | Dark surfaces, crest tile |
| `--gold` | `#B0892F` | Accent — inlay, pupil, rules (gradient `#D9B85C → #B0892F → #8A6A22`) |
| `--gold-bright` | `#E7C977` | Gold on dark surfaces |
| `--paper` | `#F6F1E7` | Primary light background |
| `--ivory` | `#FBF8F1` | Cards, chips |
| `--cream` | `#F3ECDD` | Mark / wordmark on dark |
| `--ink` | `#23302A` | Body text on light |
| `--muted` | `#5E6B5F` | Secondary / italic text |

### Verdict signal system (status only)

Tuned to heritage tones so they sit on paper without shouting. SAFE is a brighter
emerald than the brand green, so a verdict never reads as the logo.

| Verdict | Hex | Meaning |
|---|---|---|
| 🟢 **SAFE** | `#1F9D57` | Cleared — exit 0 |
| 🟡 **UNKNOWN** | `#C28A1B` | Could not verify — fail closed, exit 2 |
| 🔴 **BLOCKED** | `#B23A3A` | Out of bounds — exit 1 |

---

## 4. Typography

| Role | Typeface | Treatment |
|---|---|---|
| Wordmark / display | **Serif** — Georgia (fallback: Times New Roman → serif) | 700 weight, sentence case "Hawkeye". The heritage voice. |
| Tagline / labels | Sans — Helvetica Neue / Arial / system-ui | 600, UPPERCASE, generous tracking. |
| Descriptor | Serif *italic* — Georgia | The line under the wordmark; quietly editorial. |
| Body & UI | system-ui / Helvetica stack | 400–600 |

SVG assets reference a font stack rather than embedding a font, so the serif
logotype renders with Georgia where present and degrades gracefully.

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
