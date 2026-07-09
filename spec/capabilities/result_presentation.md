# Capability: Clean Result Presentation

## What It Does
Renders every answer clean-by-default — prose with key numbers, an interactive chart, and a summary table — with live step updates, elapsed timer, per-query token/cost, suggested follow-ups, an export action, and a hidden-by-default "show code" toggle.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| exec_result | JSON result | Sandbox | Yes |
| answer_text / chart / table | agent outputs | Agent | Yes |
| token_usage / cost / steps / elapsed | metadata | Agent + Gemini usage | Yes |
| code | string | Agent | For show-code toggle |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| rendered answer | prose + Recharts chart + table | UI chat pane |
| live steps + elapsed timer | SSE event stream | UI |
| token count + cost | number + USD | UI (per query) |
| followups | 2-3 questions | UI chips |
| export file | CSV / PNG | Download |
| code | pandas source | UI (revealed on toggle) |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| Gemini | Choose chart type + generate follow-ups | Degrade: show numbers/table without chart or follow-ups |

## Business Rules
- Clean by default: analysis code is hidden unless the user toggles "show code".
- A chart is shown only when the result is chartable; otherwise numbers + table.
- Live steps stream in order ("Profiling data…", "Writing query…", "Running locally…", "Verifying result…", "Composing answer…") with an elapsed timer.
- Per-query token count + cost come from Gemini `usage_metadata` and a per-model rate table.
- Non-functional Phase-1 UI stubs (library, multi-file, Excel, export, follow-ups, show-code) are clearly labelled "Coming soon" — never mistakable for a bug.

## Success Criteria
- [ ] A chartable answer renders an interactive Recharts chart plus prose + numbers.
- [ ] Live steps + elapsed timer appear during a query; token count + cost appear after.
- [ ] "Show code" reveals the exact pandas that produced the answer (Phase 3).
- [ ] Export downloads a non-empty CSV/PNG of the result (Phase 3).
- [ ] Each answer offers 2-3 clickable follow-up questions (Phase 3).
