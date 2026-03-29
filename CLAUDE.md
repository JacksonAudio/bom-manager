# CLAUDE.md — Rules for this project

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
