---
description: Fetch recipe from URL and create an Astro recipe page bundle
argument-hint: [url] [optional-title]
model: haiku
---

Fetch the recipe from this URL and create an Astro recipe page bundle.

Arguments: $ARGUMENTS

The first argument is the URL. If a second argument is provided after the URL, use it as the recipe title (and generate the slug from it) instead of the title on the page.

## Instructions

1. Use WebFetch to retrieve the recipe content from the provided URL. If WebFetch fails (e.g., blocked, timeout, or returns unusable content), fall back to the Playwright MCP browser: use `browser_navigate` to load the URL, then `browser_snapshot` to extract the page content.
2. Extract ONLY the information available on the page — do NOT embellish, invent, or add anything that isn't explicitly stated.
3. Determine the appropriate course from the existing options: breakfast, appetizers, entrees, sides, desserts, drinks, cocktails, soups, salads, snacks, breads, sauces. Ask if you are not sure.
4. Read `.claude/recipe-archetype.md` — this is the exact format every `index.md` must match.
5. Skip images — you only do text. The user adds a featured image manually later.
6. Create the recipe page bundle (see "Creating the recipe" below).
7. Present a summary of what was created so the user can verify.

## Creating the recipe

1. Derive the slug from the title: lowercase, replace spaces and non-alphanumeric characters with hyphens, trim leading/trailing hyphens. If an override title was provided as a second argument, slugify that instead.
2. Create the directory: `mkdir -p src/content/recipes/<course>/<slug>/`
3. Write `src/content/recipes/<course>/<slug>/index.md` using the archetype format exactly:
   - Copy the archetype structure field-by-field
   - Fill in all values extracted from the recipe
   - For optional fields that have a real value from the source: uncomment them and fill them in
   - For optional fields with no value: leave them as comment stubs exactly as the archetype shows
   - Use today's date as `date: YYYY-MM-DD` (unquoted, date only)
   - Always set `draft: true` and `featured: false`
   - Do NOT include an `image:` field (no image yet)

## Frontmatter rules

- `date`: plain `YYYY-MM-DD`, no quotes, no time component
- `course` and `cuisines`: block YAML arrays (dash-indented, not inline `[...]`)
- `cuisines`: always lowercase (e.g. `italian`, `american`, `french`)
- `dietary_tags`: allowed values ONLY — `vegetarian`, `vegan`, `gluten-free`, `dairy-free`, `keto`, `paleo`. Do NOT use any other values. Leave as `[]` if none apply.
- `servings` vs `yield`: use exactly one, never both. Comment out the other with its stub. Use `servings` (bare number, no quotes) for plated dishes (serves 4); use `yield` (quoted string) for counted items ("12 cookies", "One 9-inch pie").
- All other string values should be quoted

## Content formatting rules (apply to ingredient and instruction values)

- Do NOT reword, embellish, or add tips/notes that aren't in the original recipe.
- Ingredient names must be Capital Case (e.g., "Kosher Salt", "Vegetable Oil", "Ground Beef Chuck").
- Ingredient formatting: `[Quantity] [Unit] [Ingredient Name] [Optional Modifiers]`
- Unit abbreviations:
  - Teaspoon → `Tsp`
  - Tablespoon → `Tbsp`
  - Cup(s) → `Cup` / `Cups` (full word, capitalized)
  - Ounce(s) → `oz` (lowercase)
  - Pound(s) → `Lb` / `Lbs` (capitalized)
- Fractions for quantities, not decimals (e.g., `1/2`, `1 1/2`, `3/4`)
- Preparation notes go in parentheses after the ingredient (e.g., `"6 Tbsp Butter (Melted)"`, `"1 Large Egg (Beaten)"`)
- No quantity when ingredient is to taste (e.g., `"Kosher Salt and Black Pepper"`)
- Package sizes written inline (e.g., `"1 (28-oz) Can Crushed Tomatoes"`)
- Ingredient group/section headings (e.g. "For the dough:") go as their own entry in the `ingredients` array
- Keep instruction steps as close to the original wording as possible
- Do NOT number instruction steps — array order IS the step number
- A step may contain inline markdown (e.g. an image reference); multi-line steps are fine (use a YAML block scalar `|-`)
- Do NOT include the recipe author in the output or summary
