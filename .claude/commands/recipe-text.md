Create an Astro recipe page bundle from plain text or an image of a recipe.

Arguments: $ARGUMENTS

## Input Format

The input can be one of:

1. **A file path to an image** — a photo or screenshot of a recipe (cookbook page, handwritten recipe, social media screenshot, etc.)
2. **Plain text** — a recipe pasted directly as text (from a cookbook, family recipe card, email, etc.)

## Instructions

1. **Determine the source type:**
   - If the input looks like a file path (starts with `/`, `~`, `./`, or ends with a common image extension like `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic`), read the image using the Read tool and extract the recipe from it.
   - Otherwise, treat the input as plain text containing the recipe.

2. **Extract the recipe** from the source:
   - Identify the recipe title, ingredients, instructions, and any available metadata (prep time, cook time, servings, etc.).
   - Do NOT embellish, invent, or add anything that isn't in the source material.
   - If the source is an image, carefully read all text in the image before structuring the recipe.

3. **Determine the course** from the recipe content. Ask the user if it's unclear.

4. Read `.claude/recipe-archetype.md` — this is the exact format every `index.md` must match.

5. **Create the page bundle:**
   - Derive the slug from the title (lowercase, hyphens, no special characters)
   - Create the directory: `mkdir -p src/content/recipes/<course>/<slug>/`
   - Write `src/content/recipes/<course>/<slug>/index.md` using the archetype format exactly:
     - Fill in all values from the source material
     - For optional fields with a real value: uncomment and fill them in
     - For optional fields with no value: leave them as comment stubs exactly as the archetype shows
     - Use today's date as `date: YYYY-MM-DD`, `draft: true`, `featured: false`
     - Do NOT include an `image:` field (no image yet)

6. **Frontmatter rules** (same as `/recipe`):
   - `date`: plain `YYYY-MM-DD`, unquoted, date only
   - `course` and `cuisines`: block YAML arrays
   - `cuisines`: always lowercase
   - `dietary_tags` allowed values ONLY: `vegetarian`, `vegan`, `gluten-free`, `dairy-free`, `keto`, `paleo`
   - Exactly one of `servings` (bare number) or `yield` (quoted string); comment out the unused one
   - All other string values quoted

7. **Content formatting rules** (ingredients/instructions):
   - Capital Case ingredient names
   - Unit abbreviations: Tsp, Tbsp, Cup/Cups, oz, Lb/Lbs
   - Fractions not decimals
   - Preparation notes in parentheses
   - No quantity for to-taste ingredients
   - Keep instruction wording close to the original; do not number steps

8. Let the user know no featured image was added and they can add one manually.

9. Present a summary of what was created so the user can verify.
