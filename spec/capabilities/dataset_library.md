# Capability: Dataset Library & Profiling

## What It Does
Ingests uploaded spreadsheet files, auto-profiles them (columns, types, ranges, row count, sample rows), and keeps them in a persistent library the user returns to across days.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| file | CSV (P1) / XLSX (P3), up to ~100MB | User upload | Yes |
| dataset_id | string | User selecting from library | For open/delete |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| dataset | Dataset record | SQLite + UI library sidebar |
| profile | column list (name, dtype, null_count, distinct, min, max, samples) + row_count | SQLite + UI profile panel |
| row_sample | small capped list of rows | Agent state (for LLM), never persisted to prompt in full |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Filesystem | Store raw file (+ parquet cache) | Surface upload error; no partial record |
| SQLite | Persist dataset + column profile | 500 surfaced |

## Business Rules
- Profiling is computed locally with pandas — the full file is never sent to the LLM.
- Row sample sent to the LLM is capped (`AGENT_SAMPLE_ROWS`, default ~20).
- Files up to ~100MB must profile within a few seconds (parquet cache for large files).
- `last_used_at` updates when a dataset is opened, for library ordering.
- Datasets and their profiles persist across process restarts.

## Success Criteria
- [ ] Uploading a CSV returns an accurate column list, dtypes, and exact row count.
- [ ] A 100MB CSV profiles without sending row data beyond the capped sample to Gemini.
- [ ] After a server restart, previously-uploaded datasets still appear in the library (Phase 2).
- [ ] Deleting a dataset removes it from the library and its raw file (Phase 2).
