#!/usr/bin/env python3
"""
Sync proposal numbers across related permits in permits.json.

Triggered by CI (GitHub Actions) after merges to permits.json.

Rules implemented:

1) Any occurrence of a proposal-number-like token in notes:
     ####-##-####
   (10 digits with two dashes, e.g., "1234-56-7890")
   is normalized to be prefixed with "Proposal ":
     "Proposal ####-##-####"
   Existing variants like "proposal:####-##-####" are normalized too.

2) Proposal numbers are propagated across permits that share the same *base permit id*.
   Example:
     permit_id = "BTX-Wild-North-PT1_Seg1_001"
     base id   = "BTX-Wild-North-PT1_Seg1"   (suffix "_001" stripped)

3) To support proposal-number updates, the canonical proposal number for a base id is
   selected from permits whose notes changed in the triggering merge (diff between BASE_SHA
   and HEAD_SHA). That canonical number is then written to all permits with that base id.

Backup protection:
- Any path containing a directory named "backup" (case-insensitive) is ignored and never modified.

This script is intentionally dependency-free (stdlib only).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple


PROPOSAL_NUM_RE = re.compile(r"\b(\d{4}-\d{2}-\d{4})\b")
# Optional "proposal" prefix (case-insensitive) with flexible separators, then number
PROPOSAL_WITH_OPTIONAL_PREFIX_RE = re.compile(r"(?i)\b(?:proposal\b[\s:#-]*)?(\d{4}-\d{2}-\d{4})\b")


def run_git(args: List[str]) -> str:
    """Run a git command and return stdout. Raises on non-zero exit."""
    proc = subprocess.run(["git", *args], check=True, capture_output=True, text=True)
    return proc.stdout


def try_git_show(sha: str, path: str) -> Optional[str]:
    """Return file contents at sha:path, or None if not present."""
    try:
        return run_git(["show", f"{sha}:{path}"])
    except subprocess.CalledProcessError:
        return None


def is_backup_path(path: str) -> bool:
    parts = Path(path).parts
    return any(p.lower() == "backup" for p in parts)


def detect_indent(json_text: str) -> int:
    """
    Best-effort indentation detection to minimize diffs.
    Defaults to 2 if not detected.
    """
    for line in json_text.splitlines():
        m = re.match(r"^(\s+)[\"{[]", line)
        if m:
            return max(1, len(m.group(1)))
    return 2


def base_id_from_permit_id(permit_id: str) -> str:
    # Strip a trailing "_<digits>" suffix (e.g., "_001", "_12")
    return re.sub(r"_\d+$", "", permit_id)


def normalize_proposal_prefix_in_text(text: str) -> str:
    return PROPOSAL_WITH_OPTIONAL_PREFIX_RE.sub(lambda m: f"Proposal {m.group(1)}", text)


def extract_proposal_numbers(note_value: Any) -> List[str]:
    """
    Extract proposal numbers from a note value which may be:
      - string
      - list[str]
      - None
    """
    numbers: List[str] = []
    if isinstance(note_value, str):
        numbers.extend(PROPOSAL_NUM_RE.findall(note_value))
    elif isinstance(note_value, list):
        for item in note_value:
            if isinstance(item, str):
                numbers.extend(PROPOSAL_NUM_RE.findall(item))
    return numbers


def find_permit_records(data: Any) -> List[Dict[str, Any]]:
    """
    Support the two common shapes:
      - top-level list of permit dicts
      - top-level dict with key 'permits' that is a list of permit dicts
    """
    if isinstance(data, list):
        return [p for p in data if isinstance(p, dict)]
    if isinstance(data, dict) and isinstance(data.get("permits"), list):
        return [p for p in data["permits"] if isinstance(p, dict)]
    raise ValueError("Unsupported permits.json structure: expected a list, or an object with a 'permits' list.")


def get_permit_id(permit: Dict[str, Any]) -> Optional[str]:
    if isinstance(permit.get("permit_id"), str):
        return permit["permit_id"]
    if isinstance(permit.get("permitId"), str):
        return permit["permitId"]
    return None


def get_note_field_name(permit: Dict[str, Any], preferred: str) -> str:
    # If already present, respect existing field name.
    for k in ("notes", "note", "Notes", "Note"):
        if k in permit:
            return k
    return preferred


def get_note_value(permit: Dict[str, Any], preferred: str) -> Any:
    return permit.get(get_note_field_name(permit, preferred))


def set_note_value(permit: Dict[str, Any], value: Any, preferred: str) -> None:
    permit[get_note_field_name(permit, preferred)] = value


def compute_changed_permit_ids(base_data: Optional[Any], head_data: Any, note_field: str) -> Set[str]:
    base_map: Dict[str, Any] = {}
    if base_data is not None:
        try:
            base_permits = find_permit_records(base_data)
            for p in base_permits:
                pid = get_permit_id(p)
                if pid:
                    base_map[pid] = get_note_value(p, note_field)
        except Exception:
            base_map = {}

    head_permits = find_permit_records(head_data)
    changed: Set[str] = set()
    for p in head_permits:
        pid = get_permit_id(p)
        if not pid:
            continue
        head_note = get_note_value(p, note_field)
        if pid not in base_map:
            changed.add(pid)
        else:
            if base_map[pid] != head_note:
                changed.add(pid)
    return changed


def choose_canonical_for_group(group: List[Dict[str, Any]], changed_ids: Set[str], note_field: str) -> Tuple[Optional[str], str]:
    """
    Returns (canonical_number, reason).
    canonical_number may be None if no unambiguous canonical can be determined.
    """
    # Prefer the proposal number from changed permits in this merge.
    candidates: List[str] = []
    for p in group:
        pid = get_permit_id(p)
        if pid and pid in changed_ids:
            nums = extract_proposal_numbers(get_note_value(p, note_field))
            if nums:
                candidates.append(nums[0])

    unique: List[str] = []
    for c in candidates:
        if c not in unique:
            unique.append(c)

    if len(unique) == 1:
        return unique[0], "from-changed"
    if len(unique) > 1:
        return None, f"ambiguous-changed:{unique}"

    # Fallback: if the group already has exactly one proposal number, use it.
    existing: List[str] = []
    for p in group:
        nums = extract_proposal_numbers(get_note_value(p, note_field))
        if nums:
            existing.append(nums[0])

    existing_unique: List[str] = []
    for c in existing:
        if c not in existing_unique:
            existing_unique.append(c)

    if len(existing_unique) == 1:
        return existing_unique[0], "from-existing"
    if len(existing_unique) == 0:
        return None, "none"
    return None, f"ambiguous-existing:{existing_unique}"


def canonicalize_note_value(note_value: Any, canonical: Optional[str]) -> Any:
    """
    Normalize proposal prefixes, and (if canonical provided) force the canonical proposal number.

    Preserves note_value type for str and list[str]. Leaves unknown types untouched.
    """
    # list[str]
    if isinstance(note_value, list):
        new_list: List[Any] = []
        found_canonical = False

        for item in note_value:
            if not isinstance(item, str):
                new_list.append(item)
                continue

            updated = normalize_proposal_prefix_in_text(item)
            if canonical:
                updated = re.sub(r"(?i)\bproposal\b\s*\d{4}-\d{2}-\d{4}\b", f"Proposal {canonical}", updated)
                if re.search(rf"(?i)\bproposal\b\s*{re.escape(canonical)}\b", updated):
                    found_canonical = True

            new_list.append(updated)

        if canonical and not found_canonical:
            new_list.append(f"Proposal {canonical}")

        return new_list

    # str / None
    if note_value is None:
        text = ""
    elif isinstance(note_value, str):
        text = note_value
    else:
        return note_value  # unknown type

    updated = normalize_proposal_prefix_in_text(text)

    if canonical:
        updated = re.sub(r"(?i)\bproposal\b\s*\d{4}-\d{2}-\d{4}\b", f"Proposal {canonical}", updated)
        if not re.search(rf"(?i)\bproposal\b\s*{re.escape(canonical)}\b", updated):
            if updated.strip():
                sep = " " if not updated.endswith((" ", "\n", "\t")) else ""
                updated = updated + sep + f"Proposal {canonical}"
            else:
                updated = f"Proposal {canonical}"

    return updated


def process_permits_file(
    permits_path: str,
    base_sha: Optional[str],
    head_sha: Optional[str],
    note_field: str,
    dry_run: bool,
) -> Tuple[bool, List[str]]:
    """
    Returns (changed, log_lines).
    """
    logs: List[str] = []

    if is_backup_path(permits_path):
        logs.append(f"SKIP: {permits_path} (backup folder)")
        return False, logs

    path_obj = Path(permits_path)
    if not path_obj.exists():
        logs.append(f"SKIP: {permits_path} (file not found in workspace)")
        return False, logs

    original_text = path_obj.read_text(encoding="utf-8")
    indent = detect_indent(original_text)

    try:
        head_data = json.loads(original_text)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"{permits_path} is not valid JSON: {e}") from e

    base_data: Optional[Any] = None
    if base_sha and head_sha:
        base_text = try_git_show(base_sha, permits_path)
        if base_text is not None:
            try:
                base_data = json.loads(base_text)
            except json.JSONDecodeError:
                base_data = None

    changed_ids = compute_changed_permit_ids(base_data, head_data, note_field)
    if not changed_ids:
        logs.append(f"NO-OP: {permits_path} (no permit notes changed / added in diff)")
        return False, logs

    permits = find_permit_records(head_data)

    # Group permits by base id
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for p in permits:
        pid = get_permit_id(p)
        if not pid:
            continue
        bid = base_id_from_permit_id(pid)
        groups.setdefault(bid, []).append(p)

    impacted_base_ids: Set[str] = set()
    for pid in changed_ids:
        impacted_base_ids.add(base_id_from_permit_id(pid))

    # Choose canonical number per impacted base id
    canonical_by_base: Dict[str, Optional[str]] = {}
    for bid in sorted(impacted_base_ids):
        group = groups.get(bid, [])
        canonical, reason = choose_canonical_for_group(group, changed_ids, note_field)
        if reason.startswith("ambiguous-changed"):
            # Multiple different proposal numbers were edited in the same base id in one merge.
            # Safer to fail and require a human decision.
            raise RuntimeError(f"{permits_path}: {bid}: {reason}")
        canonical_by_base[bid] = canonical
        logs.append(f"{permits_path}: {bid}: canonical={canonical or 'None'} ({reason})")

    # Apply updates only to impacted base-id groups
    changed_any = False
    for bid in impacted_base_ids:
        canonical = canonical_by_base.get(bid)
        for p in groups.get(bid, []):
            old = get_note_value(p, note_field)
            new = canonicalize_note_value(old, canonical)
            if new != old:
                set_note_value(p, new, note_field)
                changed_any = True

    if not changed_any:
        logs.append(f"NO-OP: {permits_path} (already normalized)")
        return False, logs

    new_text = json.dumps(head_data, indent=indent, ensure_ascii=False)
    if original_text.endswith("\n"):
        new_text += "\n"

    if dry_run:
        logs.append(f"DRY-RUN: {permits_path} would be updated")
        return True, logs

    path_obj.write_text(new_text, encoding="utf-8")
    logs.append(f"UPDATED: {permits_path}")
    return True, logs


def discover_changed_permits_files(base_sha: str, head_sha: str) -> List[str]:
    """
    Find changed files matching **/permits.json excluding backup/** between base_sha and head_sha.
    """
    if not base_sha or not head_sha:
        return []

    # Initial pushes can set base to all zeros.
    if re.fullmatch(r"0{40}", base_sha):
        return []

    diff = run_git(["diff", "--name-only", base_sha, head_sha])
    files: List[str] = []
    for line in diff.splitlines():
        line = line.strip()
        if not line:
            continue
        if not line.endswith("permits.json"):
            continue
        if is_backup_path(line):
            continue
        files.append(line)
    return files


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--paths",
        nargs="*",
        default=None,
        help="Explicit permits.json path(s) to process. If omitted, the script will attempt to discover changed permits.json files using BASE_SHA and HEAD_SHA.",
    )
    parser.add_argument(
        "--note-field",
        default=os.getenv("NOTE_FIELD", "notes"),
        help="Preferred note field name to write when a permit has no note field (default: notes).",
    )
    parser.add_argument(
        "--base-sha",
        default=os.getenv("BASE_SHA"),
        help="Base commit SHA for diff discovery (typically github.event.before).",
    )
    parser.add_argument(
        "--head-sha",
        default=os.getenv("HEAD_SHA"),
        help="Head commit SHA for diff discovery (typically github.sha).",
    )
    parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    base_sha = args.base_sha
    head_sha = args.head_sha

    if args.paths is None or len(args.paths) == 0:
        if base_sha and head_sha:
            paths = discover_changed_permits_files(base_sha, head_sha)
            if not paths:
                if Path("permits.json").exists() and not is_backup_path("permits.json"):
                    paths = ["permits.json"]
        else:
            paths = ["permits.json"] if Path("permits.json").exists() else []
    else:
        paths = args.paths

    if not paths:
        print("No permits.json files to process.")
        return 0

    any_changed = False
    for path in paths:
        changed, logs = process_permits_file(
            permits_path=path,
            base_sha=base_sha,
            head_sha=head_sha,
            note_field=args.note_field,
            dry_run=args.dry_run,
        )
        for line in logs:
            print(line)
        any_changed = any_changed or changed

    if any_changed:
        print("DONE: updates applied.")
    else:
        print("DONE: no updates necessary.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        raise SystemExit(2)
