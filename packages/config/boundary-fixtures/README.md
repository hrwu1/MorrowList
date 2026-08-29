# Boundary fixtures

Deliberately invalid files used to prove the dependency-boundary rules actually fire
(FND-003). They are excluded from every `tsconfig` and are never built or shipped.

`scripts/check-boundaries.mjs` lints them at their real repository paths and fails if any
one of them passes. A rule that has silently stopped matching is worse than no rule at
all: it looks like enforcement while enforcing nothing.
