#!/usr/bin/env python3
"""Synchronize proposal notes across permits sharing a base ID.

This script enforces two rules on data/permits.json:
1. Any 10-digit number with two dashes in a permit note is normalized to be
   prefixed by the word "Proposal" (e.g., "Proposal 1234-56-7890").
2. Proposal numbers are propagated to every permit that shares the same base
   permit identifier (the permit_id with the trailing _### removed).

The backup directory is intentionally untouched; only data/permits.json is read
and potentially updated.
"""
from __future__ import annotations

import json
import pathlib
import re
from typing import Dict, List, Tuple

DATA_PATH = pathlib.Path("data/permits.json")
PROPOSAL_PATTERN = re.compile(r"(?i)\b(?:proposal[^\d]{0,10})?(\d{4}-\d{2}-\d{4})\b")


def load_permits() -> List[dict]:
    with DATA_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def extract_base_id(permit_id: str) -> str:
    """Strip the trailing underscore-number from a permit id."""
    return re.sub(r"_\d+$", "", permit_id)


def collect_proposals(permits: List[dict]) -> Dict[str, str]:
    """Collect proposal numbers keyed by base permit id.

    Later occurrences win, allowing a user to update a single permit and have
    that value propagate to siblings.
    """
    proposals: Dict[str, str] = {}
    for permit in permits:
        note = permit.get("notes") or ""
        match = PROPOSAL_PATTERN.search(note)
        if match:
            proposals[extract_base_id(permit["permit_id"])] = match.group(1)
    return proposals


def ensure_proposal_in_note(note: str, proposal: str) -> str:
    """Ensure a note contains the normalized proposal entry."""
    normalized_note = note or ""

    if PROPOSAL_PATTERN.search(normalized_note):
        normalized_note = PROPOSAL_PATTERN.sub(f"Proposal {proposal}", normalized_note, count=1)
    elif normalized_note.strip():
        spacer = "" if normalized_note.endswith(" ") else " "
        normalized_note = f"{normalized_note}{spacer}Proposal {proposal}"
    else:
        normalized_note = f"Proposal {proposal}"

    return normalized_note


def sync_proposals(permits: List[dict]) -> Tuple[bool, List[dict], List[Tuple[str, str]]]:
    proposals = collect_proposals(permits)
    changed = False
    applied: List[Tuple[str, str]] = []

    for permit in permits:
        base_id = extract_base_id(permit["permit_id"])
        proposal = proposals.get(base_id)
        if not proposal:
            continue

        note = permit.get("notes") or ""
        updated_note = ensure_proposal_in_note(note, proposal)
        if updated_note != note:
            permit["notes"] = updated_note
            changed = True
            applied.append((permit["permit_id"], proposal))

    return changed, permits, applied


def main() -> None:
    permits = load_permits()
    changed, updated_permits, applied = sync_proposals(permits)

    if changed:
        with DATA_PATH.open("w", encoding="utf-8") as handle:
            json.dump(updated_permits, handle, indent=2)
            handle.write("\n")
        touched_bases = sorted({extract_base_id(pid) for pid, _ in applied})
        print("Updated proposal notes for:")
        for permit_id, proposal in applied:
            print(f"- {permit_id}: Proposal {proposal}")
        if touched_bases:
            print("Affected base IDs:")
            for base_id in touched_bases:
                print(f"- {base_id}")
    else:
        print("No proposal updates needed.")


if __name__ == "__main__":
    main()
