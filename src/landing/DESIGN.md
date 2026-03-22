# Design Brief: The TigerFS Landing Page Pattern

A reusable design system for dev tools landing pages, reverse-engineered from [tigerfs.io](https://tigerfs.io/).

---

## 1. Design Philosoph

TigerFS commits to a specific aesthetic that's rare in developer tooling: **editorial brutalism**. It borrows from newspaper and magazine layout — bold slab-serif headlines, tight grids, muted warm tones, and generous whitespace — while staying deeply technical in content. The result feels opinionated and confident without resorting to the SaaS gradient-and-illustration playbook.

The core principle: **look like a manifesto, read like documentation.**

---

## 2. Color Palette

The palette is intentionally restrained. No gradients, no saturated accents, no dark mode. Everything lives in a narrow warm-neutral band.

| Role                 | Color                        | Usage                                  |
| -------------------- | ---------------------------- | -------------------------------------- |
| Background (primary) | `#FFFFFF` / pure white       | Main page background                   |
| Background (warm)    | `~#F5F0E8` / parchment/cream | Section backgrounds, alternating bands |
| Background (dark)    | `~#2A2A2A` / near-black      | Code blocks, terminal UI, footer       |
| Text (primary)       | `~#1A1A1A` / near-black      | Headlines, body copy                   |
| Text (secondary)     | `~#666666` / medium gray     | Labels, captions, secondary copy       |
| Text (on dark)       | `~#E0E0E0` / light gray      | Code text on dark backgrounds          |
| Accent               | `~#D4443B` / muted red       | CTA buttons, sparse highlights         |
| Border/Rule          | `~#D0D0D0` / light gray      | Section dividers, table borders        |

**Key takeaway:** The warmth comes from the cream/parchment backgrounds, not from colorful accents. The red is used surgically — one or two CTAs on the entire page. This restraint is what makes it feel editorial rather than startup-y.

---

## 3. Typography

This is where TigerFS makes its strongest design statement.

### Headline / Display

- **Family:** A compressed/condensed slab-serif or heavy grotesque (visually similar to Druk, Garage Gothic, or a tight-tracking Impact variant)
- **Weight:** Black / 900
- **Case:** Lowercase — this is critical to the personality. "the filesystem is the API." reads like a thesis statement, not a product tagline.
- **Size:** Very large. The hero headline occupies roughly 40–50% of viewport height.
- **Line height:** Extremely tight (~0.9–1.0). Lines nearly touch.
- **Tracking:** Tight or default. No letter-spacing.

### Section Headers

- **Family:** Same slab-serif/grotesque as display, or a bold weight of the body font
- **Weight:** Bold to Black
- **Size:** ~28–36px
- **Case:** Lowercase
- **Pattern:** Often preceded by a small-caps label ("the problem", "use cases", "how it works")

### Body / Prose

- **Family:** A clean sans-serif (likely system or a neutral grotesque)
- **Weight:** Regular (400)
- **Size:** ~16–18px
- **Line height:** ~1.5–1.6
- **Measure:** Constrained to ~60–70ch per line

### Labels / Section Markers

- **Family:** Monospace or small-caps sans-serif
- **Weight:** Regular
- **Size:** ~11–13px
- **Case:** Uppercase / small-caps
- **Color:** Secondary gray
- **Examples:** "THE PROBLEM", "FILE-FIRST", "DATA-FIRST", "USE CASES"

### Code

- **Family:** Monospace (system or a standard like SF Mono, JetBrains Mono, Fira Code)
- **Background:** Dark (`#2A2A2A` range)
- **Text:** Light gray/green terminal palette
- **Border-radius:** Minimal (2–4px) or none

**Key takeaway:** The entire typographic personality comes from one bold choice — the oversized, compressed, lowercase display font. Everything else is deliberately quiet to let that headline dominate.

---

## 4. Layout & Spatial Composition

### Grid System

- Max content width: ~1100–1200px, centered
- Two primary column layouts: full-width and 50/50 split
- No sidebar. Fully linear scroll.

### Section Anatomy

TigerFS uses a repeating section pattern:

```
┌─────────────────────────────────────────────┐
│  LABEL (small caps, gray)                   │
│                                             │
│  ## section headline                        │
│  (large, lowercase, bold)                   │
│                                             │
│  ┌──────────────┐  ┌──────────────┐         │
│  │  Column A    │  │  Column B    │         │
│  │  (prose or   │  │  (prose or   │         │
│  │   code)      │  │   code)      │         │
│  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────┘
```

### Alternating Backgrounds

Sections alternate between white and cream/parchment to create visual rhythm without borders or heavy dividers. Thin horizontal rules (`1px`, light gray) sometimes separate sub-sections within a band.

### Hero Section

- Left side: Giant headline (no image, no illustration)
- Right side: One-liner description + install command in a terminal-styled input + two CTAs
- The hero is text-only. No hero image, no screenshot, no animation. This is a deliberate editorial choice.

### "How It Works" Flow Diagram

- Horizontal pipeline rendered as styled boxes with arrows: `Unix Tools → Filesystem → TigerFS → PostgreSQL`
- Each box has a label and subtitle
- Contained in a lightly bordered, centered card
- This is the closest thing to an "illustration" on the page

### Use Cases Section

- Two-column layout: prose description on the left, code block on the right
- Each use case is a self-contained row
- A mode label ("File-first" / "Data-first") groups related use cases
- The code is real, runnable shell commands — not pseudocode

### Final CTA / Install Section

- Dark background (near-black)
- Terminal-style install commands
- Single red CTA button
- This is the only section with a dark background, creating a natural "end cap"

---

## 5. Component Inventory

### Navigation

- Sticky top bar, minimal: logo left, 2–3 text links center, one outlined CTA button right
- No hamburger menu, no dropdowns, no mega-menu
- Logo is text-only (product name in the display typeface)

### CTA Buttons

- **Primary:** Filled, muted red background, white text, slight border-radius
- **Secondary:** Outlined or text-only with arrow (`→`)
- Button count is minimal — two in the hero, one at the bottom. That's it.

### Install Command Widget

- Monospace text in a bordered box with a copy affordance
- Light background variant (hero) and dark background variant (footer)
- Prefixed with `$` to signal shell context

### Code Blocks

- Dark background
- Syntax highlighting (minimal — mostly just comment vs. command differentiation)
- Real, copy-pasteable commands
- Preceded by a comment line explaining intent (`# agent A writes research findings`)

### Section Labels

- Small, uppercase, letterspaced text in gray
- Positioned above headlines as a "super-title"
- Sets semantic context: "THE PROBLEM", "HOW IT WORKS", "USE CASES"

### Comparison Table (vs. section)

- Not a traditional `<table>` — rendered as a styled list
- Each item: `vs. X` in bold, followed by a one-line description
- Clean, scannable, no visual chrome

### Footer

- Minimal: logo, 4–5 links, attribution line
- Same background as the main page (not dark)
- Single horizontal rule as separator

---

## 6. Content Strategy

This is as important as the visual design. TigerFS's copy follows strict patterns:

### Hero Formula

```
[Problem-aware hook — 6-8 words, casual tone]

[Core thesis — 4-8 words, bold, declarative, lowercase]
```

Example: _"Agents love files. Lose the limitations."_ → **"the filesystem is the API."**

### Section Formula

```
[Label: what this section is about]
[Headline: what the reader should take away — framed as a problem or a benefit]
[2-3 sentences of supporting prose]
```

### Code-as-Content

Every use case is demonstrated with real shell commands, not architecture diagrams or flowcharts. The code IS the explanation. This works because:

- The target audience reads code fluently
- Shell commands are universal (no framework-specific syntax)
- Comments in the code carry the narrative

### Comparison Framing

Instead of a feature matrix, TigerFS uses terse "vs." statements. Each comparison is one sentence that names the pain point of the alternative and implies TigerFS's solution. No feature checkmarks, no "✅ / ❌" grids.

---

## 7. Anti-Patterns (What This Page Deliberately Avoids)

Understanding what TigerFS doesn't do is as instructive as what it does:

- **No illustrations or graphics.** No isometric diagrams, no blob illustrations, no abstract art. The only visual elements are typography and code.
- **No screenshots or product UI.** The product is a CLI/filesystem tool, so there's no app chrome to show — but even if there were, this design language would likely avoid it in the hero.
- **No testimonials or social proof.** No "trusted by X companies", no logo bars, no quote carousels.
- **No pricing section.** This is an open-source tool, so pricing isn't relevant — but the absence of any commercial pressure reinforces the editorial tone.
- **No animations or scroll effects.** The page is static HTML/CSS. No parallax, no fade-ins, no intersection observers. Content is just _there_.
- **No dark mode toggle.** One palette, one opinion.
- **No chatbot widget, no newsletter signup, no popups.**

---

## 8. Adaptation Guide

To apply this pattern to another dev tool landing page:

### Step 1: Pick Your Display Typeface

This is the single highest-leverage decision. Find a condensed, heavy-weight typeface that feels opinionated. Good options to explore (don't just default to the first one): Druk, Knockout, Barlow Condensed (Black), Oswald (Bold), Big Shoulders Display, Anton, Bebas Neue. The font should feel almost too big and too bold — that's the point.

### Step 2: Constrain Your Palette

Pick one warm neutral for backgrounds (cream, off-white, light khaki) and one accent color used in exactly 1–3 places. Resist adding a second accent. Let the typography carry the visual weight.

### Step 3: Write Headlines as Thesis Statements

Lowercase. Declarative. Short. The headline should be something you'd argue at a bar, not something you'd put on a billboard. "the database you don't have to learn." "config files are infrastructure." "your terminal is the dashboard."

### Step 4: Show, Don't Diagram

Replace architecture diagrams with real code. Replace feature lists with use-case scenarios. If you can express it as a shell session, do that instead of a flowchart.

### Step 5: Section Rhythm

Alternate white and cream backgrounds. Keep each section to one idea. Use small-caps labels above section headlines to orient the reader. Don't try to pack multiple messages into one viewport.

### Step 6: Minimize Navigation

Logo, docs link, GitHub link, install button. That's all you need. If your product has more surface area, add a docs site — don't bloat the landing page nav.

---

## 9. Implementation Notes

### CSS Custom Properties (starter)

```css
:root {
   /* Palette */
   --color-bg-primary: #ffffff;
   --color-bg-warm: #f5f0e8;
   --color-bg-dark: #2a2a2a;
   --color-text-primary: #1a1a1a;
   --color-text-secondary: #666666;
   --color-text-on-dark: #e0e0e0;
   --color-accent: #d4443b;
   --color-border: #d0d0d0;

   /* Typography scale */
   --font-display: "Your-Condensed-Bold", sans-serif;
   --font-body: "Your-Clean-Sans", system-ui, sans-serif;
   --font-mono: "JetBrains Mono", "SF Mono", monospace;
   --font-label: var(--font-body);

   /* Sizes */
   --text-hero: clamp(3.5rem, 8vw, 7rem);
   --text-section: clamp(1.75rem, 3vw, 2.25rem);
   --text-body: 1.125rem;
   --text-label: 0.75rem;
   --text-code: 0.875rem;

   /* Layout */
   --max-width: 1140px;
   --section-padding: 5rem 0;
   --grid-gap: 2rem;
}
```

### Recommended Font Pairings

| Display                   | Body          | Vibe                          |
| ------------------------- | ------------- | ----------------------------- |
| Druk Wide Bold            | Söhne         | High-end editorial            |
| Knockout 73               | Untitled Sans | Industrial-confident          |
| Big Shoulders Display 900 | DM Sans       | Approachable-bold             |
| Barlow Condensed 800      | IBM Plex Sans | Technical-clean               |
| Bebas Neue                | Source Sans 3 | Budget-friendly, still punchy |

---

_Brief prepared March 2026. Based on visual analysis of tigerfs.io._
