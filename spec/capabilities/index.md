# Capabilities Index

> One file per capability. These four span the whole product; phases advance them incrementally (see `spec/roadmap.md`).

## Capabilities in This Project

| Capability | File | First real in |
|-----------|------|---------------|
| Dataset library & profiling | [dataset_library.md](dataset_library.md) | Phase 1 (upload+profile), Phase 2 (persistent library) |
| Conversational analysis loop | [conversational_analysis.md](conversational_analysis.md) | Phase 1 (single-CSV), Phase 4 (hardened) |
| Multi-source analysis | [multi_source_analysis.md](multi_source_analysis.md) | Phase 3 |
| Clean result presentation | [result_presentation.md](result_presentation.md) | Phase 1 (prose+chart+steps/cost), Phase 3 (export/follow-ups/show-code) |

## How to Add a New Capability

Run `/zero-shot-build [description]`. The spec-writer creates a new `<name>.md`, updates this index, flags dependencies, and self-reviews fit.
