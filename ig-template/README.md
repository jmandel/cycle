# ig-template - Publisher shim

This directory is intentionally minimal. The published site is rendered by
`site-gen`, not by the FHIR IG Publisher's Jekyll output.

The IG Publisher still needs a template while it performs the FHIR work that we
do keep: validation, snapshots, terminology expansion, and `output/package.db`.
`ig-gh-actions.ini` points at this local template so the build does not opt in to
the public build.fhir.org pipeline or depend on a checked-out `template/`
working directory.

The visual design lives under `site-gen/designs/cycle/`. Do not add site chrome,
fonts, CSS, or design-system assets here unless the Publisher itself requires
them to produce `package.db`.
