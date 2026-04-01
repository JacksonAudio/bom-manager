# CLAUDE.md — Rules for this project

## MANDATORY: Always show code inline — never make the user open a file

When the user needs to run SQL, paste config, copy credentials, or use any other code output, **always paste the full content directly in the chat response**. Never say "see the file at X" or "open Y and copy it." If there's a migration to run, dump the SQL right there. If there's JSON to paste, show it. The user must never have to open a file to get something they need to use.

## MANDATORY: Maximum 12 Serverless Functions

Vercel Hobby plan hard-limits to **12 serverless functions** in `api/`. Current 12:
`backup`, `lcsc-search`, `low-stock-alert`, `mouser-cart`, `notifications`, `parse-invoice`, `register`, `search-components`, `shipstation`, `shopify`, `ti-search`, `zoho`

**Never add a 13th file to `api/`.** Instead, add new functionality as a new `type` inside `notifications.js` (or another existing file). The build will fail and the site will go down if this limit is exceeded.

## MANDATORY: Version bump on every push

**Every single time you push code to any branch, you MUST:**

1. Increment the version number in `src/App.jsx` → `APP_VERSION`
   - Minor feature/fix: bump patch (e.g., v7.60 → v7.61)
   - Significant features: bump minor (e.g., v7.60 → v7.70)
2. Update `BUILD_TIME` in `src/App.jsx` to the **current time in Central Time (Texas)**
   - Format: `"YYYY-MM-DDTHH:MM:SS"` (24-hour)
   - This is America/Chicago timezone (CDT = UTC-5, CST = UTC-6)
   - Use the current date/time context provided by the system, converted to Central
3. Commit the version bump as part of your final push — never push without it

**No exceptions. No forgetting. Every push. Always.**

## MANDATORY: No permission prompts — just execute

Never ask "want me to?", "shall I?", or "should I?" before pushing, committing, editing files, or any other standard operation. Just do it. The user trusts the workflow.

## MANDATORY: Always push to master

**Always push to `master`. Never push to any other branch unless explicitly told otherwise.**

When working in a worktree (e.g. `.claude/worktrees/silly-euler`), ALWAYS merge to master and push from the main repo directory immediately after every commit. Never leave commits sitting only on a worktree branch. The sequence every single time:
```
git add <files> && git commit -m "..." # in worktree
cd /Users/BradJackson/Downloads/jackson-bom && git merge <worktree-branch> && git push origin master
```

## MANDATORY: Never use React.Fragment or React.anything

React is NOT default-imported in this project. There is no `import React from "react"`.

**Always use named imports only:**
```js
import { useState, useRef, useEffect, Fragment, ... } from "react";
```

- **Never** write `React.Fragment` — use `<Fragment key={...}>` or `<>...</>` (but `<>` can't take a key)
- **Never** write `React.useRef`, `React.useState`, etc.
- **Never** write `React.createElement`

Using `React.anything` in production will throw `ReferenceError: React is not defined` and crash the entire app with a blank white page. This has happened twice. Never again.

## React 18: Reading state inside async functions

Never use side-effect variables inside setState updaters — React 18 batching defers execution:

```js
// BROKEN
let value;
setParts(prev => { value = prev.find(...); return prev; });
// value is undefined here!
```

Use the Promise pattern instead:

```js
const value = await new Promise(resolve => {
  setParts(prev => { resolve(prev.find(...)); return prev; });
});
```

## Update tab descriptions when adding features

Two places in App.jsx per tab:
1. Dashboard process flow — search `step:X, title:`
2. Tab header — search `fontSize:13,color:"#6e6e73",lineHeight:"20px"`

Update both when a push affects that tab.

## Component value formatting — MANDATORY standard

These rules apply everywhere a component value is displayed, stored, or detected (auto-fill, bulk edit, imports, API responses, etc.):

### Capacitance
- Always use `uF`, `nF`, `pF` — **never `µF` or `μF`** (µ is not keyboard-typeable and can't be searched)
- `parseFloat()` the number to strip leading zeros: `"001"` → `1`, `"0.001"` → `0.001`
- Examples: `100pF`, `10nF`, `0.1uF`, `2.2uF`, `100uF`

### Resistance
- **Below 1000Ω** → `R` suffix: `470R`, `820R`, `220R`, `100R`
- **1000Ω and above** → **lowercase `k`**: `1k`, `1.2k`, `22k`, `680k`, `1M` — **never uppercase `K`**
- **Megaohm** → `M` suffix: `1M`, `2.2M`
- Never write `470OHM` or `470 ohm` — always `470R`
- If a value is written as `1200R` it should be normalized to `1.2k`

### Inductance
- Always use `uH`, `nH`, `mH` — **never `µH`**
- Examples: `10uH`, `100nH`, `4.7uH`

### Number formatting
- Always use `parseFloat()` before outputting — strips leading zeros and normalizes decimals
- Never output `001uF`, `047uF`, etc.

### Summary table
| Wrong | Correct |
|-------|---------|
| `0.1µF` | `0.1uF` |
| `001µF` | `1uF` |
| `680K` | `680k` |
| `470OHM` | `470R` |
| `1200R` | `1.2k` |
| `10µH` | `10uH` |

## MANDATORY: Never use native browser dialogs

**Never use `confirm()`, `alert()`, or `prompt()`.** These are ugly OS-level dialogs that break the design. Always use a styled in-app modal instead. Every confirmation, error message, and user prompt must use the modal design standard below.

## Modal / dialog styling standard

All modals must match the established design language — clean, modern, Apple-inspired:

- **Backdrop**: `rgba(0,0,0,0.55)` + `backdropFilter:"blur(4px)"`
- **Card**: `borderRadius:20`, `padding:"32px 36px"`, `boxShadow:"0 32px 80px rgba(0,0,0,0.22),0 4px 16px rgba(0,0,0,0.10)"`
- **Close button**: circular `#f5f5f7` background, hover to `#e8e8ed`, `×` symbol
- **Table**: sticky thead with `#f9f9fb` background, `border:"1px solid #f0f0f2"` container, alternating row tints (`#fff` / `#fafafa`), hover to `#f0f6ff`
- **Primary action button**: pill shape (`borderRadius:980`), solid brand color, hover darkens ~10%, disabled goes to `#c7c7cc`
- **Cancel button**: pill shape, transparent with `#d2d2d7` border, hover to `#f5f5f7`
- **Typography**: title `fontSize:20,fontWeight:700,color:"#1d1d1f"`, subtitle `fontSize:13,color:"#86868b"`, table headers `fontSize:11,textTransform:"uppercase",letterSpacing:"0.05em",color:"#86868b"`
- Always add `onMouseEnter`/`onMouseLeave` hover states to buttons for polish
- Clicking the backdrop closes the modal

## Supabase updates: only send known columns

Never spread unknown/derived objects into Supabase update calls — it will 400 if unknown columns are included. Explicitly pick only the fields being saved.

## THE MANTRA — burn this into every decision

> **Buy parts in bulk → build pedals in batches → stock the shelf → ship same day from shelf.**

Every feature, every UI decision, every workflow must serve this loop.
- Orders do NOT trigger builds. Low shelf stock triggers builds.
- Builds are NOT for specific orders. Builds are for the shelf.
- The app's #1 job is keeping the shelf stocked and visible.

## Project details

- React 18 SPA with Vite, deployed on Vercel
- Supabase (PostgreSQL) backend with RLS
- Single main file: `src/App.jsx`
- Serverless functions in `api/` directory
- Brands: Jackson Audio, Fulltone USA
- GS1 Prefixes: Jackson Audio = 605258, Fulltone USA = 676891
- The app is called "BOM Manager" (Bill of Materials). Never "bomb" or "Bomb".
