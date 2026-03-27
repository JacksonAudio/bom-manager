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

## Project details

- React 18 SPA with Vite, deployed on Vercel
- Supabase (PostgreSQL) backend with RLS
- Single main file: `src/App.jsx`
- Serverless functions in `api/` directory
- Brands: Jackson Audio, Fulltone USA
- GS1 Prefixes: Jackson Audio = 605258, Fulltone USA = 676891
- The app is called "BOM Manager" (Bill of Materials). Never "bomb" or "Bomb".
