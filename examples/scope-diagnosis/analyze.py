"""Join scope observations without treating missing evidence as a successful diagnosis."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def valid_manifest(value):
    return isinstance(value, dict) and bool(value) and all(
        isinstance(path, str) and bool(path.strip())
        and isinstance(digest, str) and re.fullmatch(r"[0-9a-fA-F]{64}", digest)
        for path, digest in value.items()
    )


def read_record(path, issues, optional=False):
    try:
        value = json.loads(path.read_text())
    except FileNotFoundError:
        if not optional:
            issues.append(f"{path.name}: missing")
        return {}
    except (UnicodeError, json.JSONDecodeError):
        issues.append(f"{path.name}: invalid JSON")
        return {}
    if not isinstance(value, dict):
        issues.append(f"{path.name}: expected an object")
        return {}
    return value


def read_events(path, issues):
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        issues.append(f"{path.name}: missing")
        return [], None
    digest = hashlib.sha256(raw).hexdigest()
    try:
        lines = raw.decode("utf8").splitlines()
    except UnicodeError:
        issues.append(f"{path.name}: invalid UTF-8")
        return [], digest
    events = []
    previous = {}
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            issues.append(f"{path.name}:{line_number}: invalid JSON")
            continue
        if not isinstance(event, dict) or not (
            isinstance(event.get("run"), str) and event["run"].strip()
            and isinstance(event.get("kind"), str) and event["kind"].strip()
            and type(event.get("pid")) is int and event["pid"] > 0
            and type(event.get("sequence")) is int and event["sequence"] > 0
            and (event.get("threadId") is None or type(event["threadId"]) is int)
        ):
            issues.append(f"{path.name}:{line_number}: invalid event fields")
            continue
        key = (event["run"], event["pid"], event.get("threadId"))
        if event["sequence"] <= previous.get(key, 0):
            issues.append(f"{path.name}:{line_number}: non-increasing sequence")
        previous[key] = event["sequence"]
        events.append(event)
    if not events:
        issues.append(f"{path.name}: no usable events")
    return events, digest


def has_stack(event, field="stack"):
    value = event.get(field) if isinstance(event, dict) else None
    return isinstance(value, str) and any(line.strip().startswith("at ") for line in value.splitlines()[1:])


def has_closed_scope_stack(event):
    return has_stack(event, "exceptionStack") and event["exceptionStack"].startswith("Error: Async work scope is closed")


def same_scope(event, anchor):
    identity = anchor.get("scope")
    return isinstance(identity, str) and bool(identity.strip()) and all(
        event.get(key) == anchor.get(key) for key in ("scope", "pid", "threadId")
    )


def chain_for(rejection, selected):
    related = [event for event in selected if same_scope(event, rejection)]
    prefix = [event for event in related if event["sequence"] <= rejection["sequence"]]
    creation = next((event for event in prefix if event["kind"] == "create"), None)
    closes = [event for event in prefix if event["kind"] in ("begin-close", "drain-start", "closed")]
    captures = [event for event in prefix if event["kind"] == "tracker-capture"]
    narratives = [event for event in prefix if event["kind"].startswith("narrative")]
    enters = [event for event in narratives if event["kind"] == "narrative-completion-enter" and event.get("narrativePhase") == "deep"]
    errors = [event for event in related if event["sequence"] >= rejection["sequence"] and event["kind"] == "narrative-completion-error" and event.get("narrativePhase") == "deep"]
    required = {
        "scope identity": isinstance(rejection.get("scope"), str) and bool(rejection["scope"].strip()),
        "scope creation stack": has_stack(creation),
        "drain caller stack": any(event["kind"] == "drain-start" and has_stack(event) for event in closes),
        "scope closed before rejection": any(event["kind"] == "closed" and event["sequence"] < rejection["sequence"] for event in closes),
        "tracker capture": any(has_stack(event) and event.get("owner") == rejection.get("scope") for event in captures),
        "deep narrative start": any(event["kind"] == "narrative-start" and event.get("narrativePhase") == "deep" for event in narratives),
        "deep completion boundary owner": any(has_stack(event) and event.get("owner") == rejection.get("scope") for event in enters),
        "native rejection stack": has_closed_scope_stack(rejection),
        "deep completion error stack": any(has_closed_scope_stack(event) for event in errors),
    }
    missing = [name for name, present in required.items() if not present]
    return {"rejection": rejection, "creation": creation, "closeEvents": closes,
            "trackerCapture": captures, "narrativeEvents": narratives,
            "completionErrors": errors, "missingEvidence": missing,
            "ownershipChainComplete": not missing}


def completed_publishers(maintenance):
    if not isinstance(maintenance, dict):
        return False
    publishers = maintenance.get("publishers")
    sweep = maintenance.get("sweep")
    return (
        isinstance(publishers, dict)
        and all(publishers.get(phase) == "completed" for phase in ("light", "rem", "deep"))
        and isinstance(sweep, dict) and sweep.get("completionStatus") == "succeeded"
    )


def analyze(case):
    case = Path(case)
    issues = []
    result = read_record(case / "result.json", issues)
    continuation = read_record(case / "continuation.json", issues, optional=True)
    events, trace_digest = read_events(case / "scope-events.jsonl", issues)
    manifests = [result.get(name) for name in ("beforeNative", "beforeSdk", "snapshotManifest")]
    manifests_valid = all(valid_manifest(value) for value in manifests)
    identical = manifests_valid and manifests[0] == manifests[1] == manifests[2]
    if not identical:
        issues.append("snapshot manifests: missing or invalid" if not manifests_valid else "snapshot manifests: mismatch")
    eligibility = result.get("eligibility")
    passes = eligibility.get("passes") if isinstance(eligibility, dict) else None
    eligible = isinstance(passes, dict) and bool(passes) and all(value is True for value in passes.values())
    if not eligible:
        issues.append("eligibility: missing or incomplete checks")

    routes = ["native", "sdk"]
    if continuation or any(event["run"] == "sdk-continuation" for event in events):
        routes.append("sdk-continuation")
    runs = {}
    for route in routes:
        selected = [event for event in events if event["run"] == route]
        narratives = [event for event in selected if event["kind"].startswith("narrative")]
        rejections = [chain_for(event, selected) for event in selected if event["kind"] in ("reject-run", "reject-track")]
        source = continuation if route == "sdk-continuation" else result
        metadata = source.get("runs")
        metadata = metadata.get("sdk" if route == "sdk-continuation" else route) if isinstance(metadata, dict) else None
        maintenance = metadata.get("maintenance") if isinstance(metadata, dict) else None
        deep = [event for event in narratives if event["kind"] in ("narrative-queue", "narrative-start") and event.get("narrativePhase") == "deep"]
        lifetimes = []
        missing = []
        for event in deep:
            related = [other for other in selected if same_scope(other, event)]
            lifetimes.append({"event": event, "subsequentCloseEvents": [other for other in related if other["kind"] in ("begin-close", "drain-start", "closed") and other["sequence"] >= event["sequence"]]})
        if not selected:
            missing.append("route trace")
        if not deep:
            missing.append("deep narrative lifecycle")
        if route == "sdk-continuation":
            restored = continuation.get("restoredSnapshot")
            if not (valid_manifest(restored) and valid_manifest(result.get("beforeNative")) and restored == result["beforeNative"]):
                missing.append("continuation snapshot matches native baseline")
        if rejections:
            missing.extend(name for chain in rejections for name in chain["missingEvidence"])
            status = "rejection-observed" if not missing else "incomplete-rejection-evidence"
        else:
            if any(event["kind"] == "narrative-completion-error" and event.get("narrativePhase") == "deep" for event in narratives):
                missing.append("deep completion error without a scope rejection")
            for start in [event for event in deep if event["kind"] == "narrative-start"]:
                related = [event for event in selected if same_scope(event, start)]
                creation = next((event for event in related if event["kind"] == "create" and event["sequence"] < start["sequence"]), None)
                enters = [event for event in related if event["kind"] == "narrative-completion-enter" and event.get("narrativePhase") == "deep" and event["sequence"] > start["sequence"] and event.get("owner") == start.get("scope") and has_stack(event)]
                tracks = [event for event in related if event["kind"] == "track-use" and any(enter["sequence"] < event["sequence"] for enter in enters) and event.get("phase") in ("open", "closing")]
                closed = [event for event in related if event["kind"] == "closed" and any(track["sequence"] < event["sequence"] for track in tracks)]
                if not (has_stack(creation) and enters and tracks and closed):
                    missing.append("complete deep owner lifecycle")
            if not any(event["kind"] == "narrative-start" for event in deep):
                missing.append("deep narrative start")
            if missing:
                status = "missing-evidence"
            elif completed_publishers(maintenance):
                status = "healthy-continuation-observed" if route == "sdk-continuation" else "publication-completed-no-rejection-observed"
            else:
                missing.append("completed publisher receipts")
                status = "no-rejection-observed"
        runs[route] = {"eventCount": len(selected), "maintenance": maintenance,
                       "narrativeEvents": narratives, "rejections": rejections,
                       "deepScopeLifetime": lifetimes, "status": status,
                       "missingEvidence": list(dict.fromkeys(missing))}
        issues.extend(f"{route}: {name}" for name in runs[route]["missingEvidence"])

    return {"runs": runs, "eventTraceSha256": trace_digest, "eventCount": len(events),
            "identicalSnapshotBytes": bool(identical), "eligibleBeforeDispatch": bool(eligible),
            "originalFailureNotOverwritten": None,
            "originalFailurePreservation": {"status": "unverified", "reason": "No original artifact and expected digest were verified by this analysis."},
            "originalCauseResolved": False,
            "evidenceStatus": "incomplete" if issues else "available",
            "missingEvidence": list(dict.fromkeys(issues)),
            "otherRunLabels": sorted({event["run"] for event in events if event["run"] not in routes}),
            "scopeOfConclusion": "Observations from this trace only; complete synthetic or later rejection chains do not establish the original failure's initiating cause."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("case", type=Path)
    args = parser.parse_args()
    result = analyze(args.case)
    (args.case / "analysis.json").write_text(json.dumps(result, indent=2) + "\n")
    for route, value in result["runs"].items():
        print(route, {"status": value["status"], "eventCount": value["eventCount"],
                      "rejections": len(value["rejections"]), "missingEvidence": value["missingEvidence"]})
