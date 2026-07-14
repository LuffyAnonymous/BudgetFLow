# UI Design Guidelines

This document defines the visual layout rules for BudgetFlow, inspired by premium corporate dashboards like Ramp, Stripe, and Copilot Money.

## Core Rules

### 1. Color Palette
* **Theme**: Deep slate dark mode (no plain black/white background, use curated HSL grays).
* **Backgrounds**: Slate-950 base, Slate-900/40 card bases with slate-800 borders.
* **Accents**: Indigo-600 (`#4f46e5`) for CTA elements, Emerald-400 for positive cash flow, Rose-400 for expenses/debts.

### 2. Layout Structure
* **Spacing**: Restrained spacing. Prevent huge cards and excess padding.
* **Layouts**: Use precise CSS grid columns for card sections. Avoid template-looking dashboards.
* **Card Sizing**: Keep cards compact. Content should fit comfortably inside the viewport height.

### 3. Elements to Avoid
* **No pure primary colors**: Prefer tailored HEX codes.
* **No oversized charts/gauges**: Keep visual representations readable.
* **No complex decorative animations**: All transitions must be simple fades/slides (`duration-200` to `duration-300`).
* **No placeholder images**: Generate mockups where necessary.
