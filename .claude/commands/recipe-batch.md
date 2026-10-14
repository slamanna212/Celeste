---
description: Process multiple recipe URLs and create Astro page bundles
argument-hint: [url1] [url2] ...
model: haiku
---

Process multiple recipe URLs and create Astro page bundles for each one.

Arguments: $ARGUMENTS

## Input Format

The arguments should contain one or more recipe URLs, one per line. Optionally, the first line can be a course override in the format `course=<course>`.

Examples:

```
https://example.com/recipe1
https://example.com/recipe2
https://example.com/recipe3
```

With course override:
```
course=desserts
https://example.com/recipe1
https://example.com/recipe2
```

## Instructions

1. Parse the input:
   - If the first line matches `course=<value>`, extract it as the course override and remove it from the URL list.
   - Treat all remaining non-empty lines as recipe URLs.

2. Read `.claude/commands/recipe.md` — it contains all the formatting rules for a single recipe. Apply those rules for every recipe in this batch.

3. Also read `.claude/recipe-archetype.md` — this is the exact format every `index.md` must match.

4. For each URL, process it exactly as the `/recipe` command would:
   - Fetch the recipe content using WebFetch (fall back to Playwright MCP browser if WebFetch fails).
   - Extract ONLY the information available on the page — no embellishment.
   - If a course override was provided, use it. Otherwise determine the course from the recipe content. Ask the user if unsure.
   - Derive the slug, create the directory, and write `index.md` directly following the archetype format (see `recipe.md` for full rules). Do NOT use `scripts/new-content.js`.
   - Omit `image` — text-only authoring; user adds images manually.
   - If a URL fails (blocked, unusable content), record the failure and continue with the rest.

5. After processing all URLs, present a summary table:

| # | Recipe | Course | Path |
|---|--------|--------|------|
| 1 | Banana Pancakes | breakfast | src/content/recipes/breakfast/banana-pancakes/ |
| 2 | ... | ... | ... |

Report any URLs that failed and why.
