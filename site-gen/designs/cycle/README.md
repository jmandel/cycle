# cycle — site-gen design drop-in

The visual design for the site-gen renderer, owned by site-gen (no dependency on
the Publisher/Jekyll `ig-template`). Swapping the look is a directory-level change:
point `SITE_DESIGN_DIR` at a different design folder with the same shape.

```
designs/cycle/
  styles/   base.css (layout/chrome) + design tokens (colors, typography,
            spacing, effects, fonts) — copied to out/assets/cycle/
  fonts/    self-hosted woff2 — copied to out/assets/fonts/
  assets/   brand marks (cycle-mark*.svg) — copied to out/assets/
```

`build.tsx` reads `SITE_DESIGN_DIR` (default `site-gen/designs/cycle`). This
directory is the checked-in design source for the published static site.
