# AGENTS.md

This file is read automatically at the start of every session in this workspace. Follow it on every task without being reminded. It defines three roles you move through in order: **Builder → QA → Tester**. Do not skip a stage, and do not show final output to the user until Tester has passed it.

---

## STAGE 1 — BUILD RULES

Your instinct toward generic, templated output is the thing this section overrides.

### No default AI aesthetic (instant "AI-slop" tells — avoid all of these)
- Cream/off-white background (~#F4F1EA) + high-contrast serif headline + terracotta/clay accent (~#D97757)
- Near-black background + one bright acid-green or vermilion accent
- "Broadsheet" layout: hairline rules, zero border-radius, dense newspaper columns
- Purple-to-blue gradient backgrounds or buttons
- Generic centered hero → centered subtext → centered CTA → 3 identical feature cards in a row
- Numbered feature cards (01 / 02 / 03) unless the content is genuinely a sequence
- Inter or Roboto used for headings, body, AND UI text with no pairing
- Emoji used as icons in a real UI
- Glassmorphism or heavy soft drop-shadows on every card
- Every corner at the same border-radius with no variation or intent
- Generic stock-photo people, abstract blobs, or "3D gradient sphere" hero art
- Uniform, arbitrary padding (e.g. `p-4` everywhere) instead of a real spacing scale
- Feature grids where every card repeats icon-on-top / bold-title / one-line-description identically 3–6x
Do not use any of the above unless the user explicitly asked for it.

### Ground every decision in the actual product
State who this is for, its one job, and what makes it different from any other app in this category — before choosing colors, fonts, or layout. Every choice must trace back to that, not to "what looks fine on any app."

### Design token pass, before code
Define explicitly, before writing CSS, and reuse consistently across every screen — consistency is what makes a UI read as designed rather than assembled:

**Color**
- One primary accent color chosen for what the product *means*, not a default gradient
- Neutrals slightly warm- or cool-tinted, never pure `#000`/`#888`/`#fff`
- Build as a scale, not three flat values:
  ```
  --neutral-50 ... --neutral-900
  --accent-50 ... --accent-900
  ```
- Flat color, 1px borders, or a single-direction shadow over glassmorphism/heavy blur
- Dark mode (if used) is not just inverted grays — recheck contrast and accent saturation separately

**Type**
- 1 display/heading font with character + 1 clean, highly legible body/UI font (+ 1 monospace for code/data if needed) — never one font doing every job
- Fixed type scale (ratio 1.25–1.5), not eyeballed sizes:
  ```
  --text-xs: 0.75rem   --text-sm: 0.875rem   --text-base: 1rem
  --text-lg: 1.25rem   --text-xl: 1.563rem   --text-2xl: 1.953rem
  --text-3xl: 2.441rem --text-4xl: 3.052rem
  ```
- Tighten `letter-spacing` on large headings (`-0.02em` to `-0.04em`)
- Deliberate font-weight: 400 body, 500/600 labels & subheadings, 700 only for real emphasis

**Layout & spacing**
- 8pt spacing scale only: 4, 8, 12, 16, 24, 32, 48, 64, 96px — nothing arbitrary
- Break symmetry on purpose: asymmetric hero, unequal columns, content bleeding to an edge — not everything centered in a max-width box
- Vary section rhythm — don't repeat "heading, subtext, 3-card grid" for every section
- Whitespace implies hierarchy, not just "add padding until it feels spacious"

**Components**
- One border-radius system used with intent (sharp 0–2px for technical tools, soft 8–12px for consumer, 16px+ only for hero elements) — never mixed randomly
- One icon set (Lucide, Phosphor, Heroicons, etc.), one weight/style, consistently — never emoji, never mixed sets
- Every interactive element needs real default / hover / active / focus-visible / disabled states
- Restrained micro-interactions (150–250ms transitions on hover/press)
- Empty, loading, and error states are designed, not an afterthought

**Imagery**
- Real photography, custom illustration, or actual product screenshots — not generic abstract 3D gradients/blobs or stock "person smiling at laptop"
- If no real imagery exists, prefer clean typographic/graphic compositions over placeholder art

**Signature** — the one element this build will be remembered by, specific to this product's subject matter, not a decorative flourish.

### Real content
No Lorem ipsum, no "Feature One," no "Your Company." Write real, specific copy.

### Writing voice
Active voice. Buttons say what they do ("Save changes," not "Submit"). Avoid generic marketing filler ("Empower your workflow," "Unlock your potential," "Seamlessly integrate") — be specific about what the product actually does. Errors state what happened and how to fix it — no vague messages, no apologizing. No filler.

### Motion & polish
Animate with intent, not everywhere. Responsive to mobile, visible keyboard focus, and `prefers-reduced-motion` respected are not optional.

### Code quality baseline
No dead code, no leftover console logs/commented blocks, consistent naming, no unexplained new dependencies, match existing project conventions if this is an existing codebase.

### Self-check before moving to QA
- If this exact prompt were run again with no other context, would the result land close to this? If yes, it's a default — revise the generic part and note what changed.
- Does this layout look like a template seen a hundred times, or does it have a specific structure?
- Are exactly 2–3 fonts used, paired deliberately, on one consistent type scale?
- Is there one consistent 8pt spacing scale throughout?
- Is there one accent color, applied with restraint?
- Is the border-radius consistent and intentional?
- Are icons from one consistent set, not emoji?
- Do interactive elements have real hover/focus/active/disabled states?

---

## STAGE 2 — QA

Do not review your own build uncritically. Go through this checklist item by item — Pass / Fail / N/A, one-line reason each. Don't skip any.

**Aesthetic**
- [ ] Avoids every item in the "No default AI aesthetic" list
- [ ] No numbered cards unless content is a genuine sequence
- [ ] No unjustified gradients/glassmorphism/emoji-as-icons

**Design system**
- [ ] 2–3 fonts max, deliberately paired, on one fixed type scale
- [ ] One 8pt spacing scale used throughout — no arbitrary padding
- [ ] One accent color (as a scale, not a flat value), applied with restraint; neutrals aren't pure black/white
- [ ] One border-radius system, applied with intent, not mixed randomly
- [ ] One consistent icon set — no emoji, no mixed sets
- [ ] Interactive elements have default/hover/active/focus-visible/disabled states
- [ ] Empty, loading, and error states are actually designed, not default browser/framework output

**Product grounding**
- [ ] Palette, type, and layout are specific to this product
- [ ] There's an identifiable signature element
- [ ] Imagery (if any) is real/custom, not generic stock or gradient blobs

**Content**
- [ ] No placeholder text anywhere
- [ ] Copy is specific and active-voice, no marketing filler ("empower," "unlock," "seamlessly")
- [ ] Error/empty states are clear, not vague or apologetic

**Motion & accessibility**
- [ ] Animation is deliberate, not excessive
- [ ] Responsive at mobile width
- [ ] Keyboard focus states visible
- [ ] Reduced motion respected (if animation exists)

**Code**
- [ ] No dead code, stray logs, or commented-out blocks
- [ ] No unexplained new dependencies
- [ ] Consistent naming/structure

**Verdict:** PASS → move to Stage 3. FAIL → list every failed item with a specific fix instruction, and redo Stage 1 for those items. Do not proceed to Stage 3 on a FAIL.

---

## STAGE 3 — TESTER

This is the last gate before anything is shown as finished. Actually run it — don't review by eye only.

1. **Build check** — run the build/compile/lint step. Zero errors required. Stop and go back to Stage 1 if it doesn't build clean.
2. **Runtime check** — actually load/run it. Console/log output must be free of errors on load. Click through every interactive element and every state (empty, loading, error, success).
3. **Functional correctness** — every requested feature actually works, not just renders. Test realistic and adversarial input: empty fields, long text, special characters, wrong types, rapid double-actions.
4. **Responsive & visual check** — mobile and desktop widths, nothing overlapping/cut off, text legible against its background.
5. **Edge cases** — empty state, failed request (if applicable), very long/very short input.

**Verdict:** PASS → deliver to the user. FAIL → list exact reproduction steps and the error, send back to Stage 1. Never deliver a failing or partially-broken build without saying explicitly what's broken.

---

## Session behavior
- Apply all three stages to every task in this workspace without being asked.
- When reporting back, briefly state the QA and Tester verdicts (pass/fail + what was checked) before showing the final result — don't just silently claim it's done.
