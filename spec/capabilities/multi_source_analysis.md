# Capability: Multi-Source Analysis

## What It Does
Analyzes multi-sheet Excel workbooks and joins across multiple files within a single conversation, exposing each sheet/file as a named frame to the analysis code.

## Inputs
| Input | Type | Source | Required |
|-------|------|--------|----------|
| xlsx file | Excel workbook (multi-sheet) | User upload | For Excel path |
| dataset_ids | list of strings | User attaching files to a conversation | For join path |
| sheet_name | string | User sheet picker | For Excel path |

## Outputs
| Output | Type | Destination |
|--------|------|-------------|
| per-sheet profiles | column profiles per sheet | SQLite (DatasetSheet/DatasetColumn) + UI |
| named frames | {frame_name: file_path} | Agent state → sandbox |
| joined answer | prose + chart + table | Message record + UI |

## External Calls
| System | Operation | On Failure |
|--------|-----------|------------|
| openpyxl / pandas | Parse + profile each sheet | Surface parse error per sheet |
| Sandbox | Run join code across multiple frames | Route to reflect → retry (bounded) |

## Business Rules
- Each Excel sheet and each attached file is a distinctly-named frame; the agent plans joins from the profiles.
- A conversation may reference multiple datasets (ConversationDataset link).
- Join keys are inferred by the agent from profiles; ambiguous joins trigger a clarifying question.

## Success Criteria
- [ ] A multi-sheet xlsx profiles every sheet with correct columns/row counts.
- [ ] A two-file join returns the correct aggregate vs a ground-truth pandas `merge`.
- [ ] Adding a second file to a conversation makes both frames available to the next question.
