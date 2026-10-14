---
title: "Recipe Title"
description: "Short description for SEO and recipe cards"
date: 2026-07-06
# updated: 2026-07-07
draft: true

course:
  - entrees
cuisines:
  - american
tags: []
dietary_tags: []
# season:
#   - fall
#   - winter

prepTime: "15 minutes"
# cookTime: "30 minutes"
# restTime: "1 hour"
servings: 4
# yield: "12 cookies"

difficulty: "easy"
# equipment:
#   - stand mixer
#   - cast iron skillet
# requires:
#   - /recipes/sauces/marinara
featured: false
# image: ./featured.jpg

# timers:
#   - label: "Simmer sauce"
#     minutes: 25
#     step: 3

ingredients:
  - "1 Cup All-Purpose Flour"
  - "2 Large Eggs"

instructions:
  - "Step one."
  - "Step two."
---

<!--
Everything below the closing `---` is the markdown BODY. It is optional and split into
two parts by the `## Notes` heading:

  * Text BEFORE `## Notes` renders as the intro — a short paragraph of context shown
    above the ingredients (`extractIntro` in src/lib/recipeData.ts).
  * `- ` bullets AFTER `## Notes` render as the Notes card at the bottom of the page
    (`extractNotes`). Only lines starting with `- ` are kept; anything else is dropped
    silently.

Rules when generating a recipe:

  * Leave the body COMPLETELY EMPTY by default. Stop at the closing `---`.
  * NEVER invent an intro. This site exists to avoid padded food-blog headnotes. An
    intro is first-person context the site owner writes; it is not summarizable from a
    source recipe. If the source has no such context, there is no intro.
  * Only add `## Notes` if the source contains actual cooking tips, and copy them
    verbatim as `- ` bullets. Do not write your own.
  * Never emit an empty `- ` bullet, and never emit Hugo shortcodes (`{{< ... >}}`) —
    scripts/validate-recipes.js errors on both.
  * Intros over 500 characters trigger a validator warning; they are meant to be short.
-->
