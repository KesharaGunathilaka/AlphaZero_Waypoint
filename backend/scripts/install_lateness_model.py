"""Install our Datathon Task 1 model for the API, and prove it is the model we submitted.

The model files and the history statistics are derived from the competition data, so they are not kept in this
repository (the booklet forbids publishing derivatives). Point the script at the files on your machine:

    cd backend
    uv run python scripts/install_lateness_model.py \
        --models ../../AlphaZero_Datathon/models/task1 \
        --data "../../Datathon/data" \
        --submission ../../AlphaZero_Datathon/submissions/submission_task1.csv \
        --out models/task1

It copies the nine LightGBM files and manifest.json unchanged, builds the as-of history the submission used
(labelled training rows before the manifest's cutoff, 16 Feb 2026), then reruns the Datathon test set through
app/modules/lateness/task1.py and requires our submitted predictions back. Then set LATENESS_MODEL_DIR to --out
(Docker: the api service mounts it).
"""
import argparse
import gzip
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.modules.lateness.task1 import HISTORY_FILE, Task1Model, add_static_features, build_history  # noqa: E402

TIME_COLS = ["planned_depart_time", "planned_arrival_time", "actual_depart_time", "arrival_time",
             "leave_outlet_time", "window_open_time", "window_close_time"]
ID_COLS = ["delivery_id", "route_id", "outlet_id", "vehicle_id", "leg_id", "to_outlet", "from_point"]
SHARED = ["vehicle_id", "vehicle_type", "vehicle_temp", "brand", "district", "depot", "planned_arrival_time"]


def read(root: Path, name: str) -> pd.DataFrame:
    hits = sorted(p for p in root.rglob(name) if not p.name.startswith("."))
    if not hits:
        raise SystemExit(f"{name} not found under {root}")
    return pd.read_csv(hits[0], dtype={c: str for c in ID_COLS + TIME_COLS})


def hhmm_to_min(s: pd.Series) -> pd.Series:
    parts = s.astype("string").str.extract(r"^(\d{2}):(\d{2})$").astype(float)
    return parts[0] * 60 + parts[1]


def build_base(deliv, legs, outlets, allowance):
    """§2.4: one row per dispatched order, joined to its route leg."""
    d = deliv[deliv.route_id.notna()].copy()
    d["seq"] = d["seq_in_route"].astype(int)
    m = d.merge(legs, on=["route_id", "seq"], how="left", suffixes=("", "_leg"), validate="one_to_one")
    m = m.drop(columns=[c + "_leg" for c in SHARED])
    for c in TIME_COLS:
        if c in m.columns:
            m[c.replace("_time", "_min")] = hhmm_to_min(m[c])
    for c in ["date", "order_date", "dispatch_date"]:
        m[c] = pd.to_datetime(m[c])
    m = m.merge(outlets[["outlet_id", "dock_type", "parking_constraint"]], on="outlet_id", how="left", validate="many_to_one")
    m = m.merge(allowance, on=["brand", "dock_type"], how="left", validate="many_to_one")
    m["n_stops"] = m.groupby("route_id").seq.transform("size")
    return m.sort_values(["date", "route_id", "seq"]).reset_index(drop=True)


def add_labels(b):
    """§2.6: service from the later of arrival and window open; late = arrival after window close."""
    b = b.copy()
    b["service_min"] = b.leave_outlet_min - np.maximum(b.arrival_min, b.window_open_min)
    b["is_late"] = (b.arrival_min > b.window_close_min).astype(int)
    return b


def add_label_side_columns(h):
    """Columns derived from actual outcomes; used only inside history aggregates, never as features."""
    h = h.copy()
    h["log_svc"] = np.log1p(h["service_min"])
    h["travel_ratio"] = h["actual_travel_duration_min"] / h["phys_travel"]
    h["travel_ratio_nd"] = h["actual_travel_duration_min"] / h["phys_travel_nd"]
    h["start_delay"] = np.where(h["seq"].eq(0), h["actual_depart_min"] - h["planned_depart_min"], np.nan)
    h["svc_per_unit"] = h["service_min"] / h["order_units"].clip(lower=1)
    h["svc_per_kg"] = h["service_min"] / h["order_weight_kg"].clip(lower=1)
    return h


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--models", required=True, type=Path, help="the Datathon's models/task1 folder (manifest.json + 9 files)")
    ap.add_argument("--data", required=True, type=Path, help="the Datathon data folder (training, test and general CSVs)")
    ap.add_argument("--submission", required=True, type=Path, help="our submission_task1.csv, for the parity check")
    ap.add_argument("--out", default=Path("models/task1"), type=Path)
    args = ap.parse_args()

    manifest = json.loads((args.models / "manifest.json").read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.models / "manifest.json", args.out / "manifest.json")
    for files in manifest["files"].values():
        for f in files:
            shutil.copy2(args.models / f, args.out / f)
    print(f"copied manifest.json and {sum(map(len, manifest['files'].values()))} model files to {args.out}")

    raw = {k: read(args.data, f) for k, f in {
        "dtr": "deliveries_train.csv", "ltr": "route_legs_train.csv", "dte": "task1_test_inputs.csv",
        "lte": "route_legs_test.csv", "outlets": "outlets.csv", "vehicles": "vehicles.csv", "calendar": "calendar.csv",
        "allowance": "service_allowance.csv", "traffic": "traffic_speed.csv", "road": "road_conditions.csv"}.items()}
    ref = {k: raw[k] for k in ["calendar", "traffic", "road", "outlets", "vehicles"]}

    train = add_static_features(add_labels(build_base(raw["dtr"], raw["ltr"], raw["outlets"], raw["allowance"])), ref)
    cutoff = pd.Timestamp(manifest["history_cutoff"])
    history = build_history(add_label_side_columns(train), cutoff)
    with gzip.open(args.out / HISTORY_FILE, "wt", encoding="utf-8") as fh:
        json.dump(history, fh, default=lambda o: o.item())
    print(f"history as of {cutoff.date()}: {len(train):,} labelled rows -> "
          + ", ".join(f"{k} {len(v['rows'])}" for k, v in history["blocks"].items()))

    # Parity: the Datathon test set through the production code must give back what we submitted.
    model = Task1Model.load(args.out)
    test = add_static_features(build_base(raw["dte"], raw["lte"], raw["outlets"], raw["allowance"]), ref)
    pred = model.predict(model.features(test, pd.Series(cutoff, index=test.index)))
    sub = pd.read_csv(args.submission, dtype={"delivery_id": str})
    got = pd.DataFrame({"delivery_id": test.delivery_id, "late": pred.p_late, "svc": pred.p_svc})
    m = sub.merge(got, on="delivery_id", how="inner", validate="one_to_one")
    d_late = (m.late.round(5) - m.pred_late_prob).abs().max()
    d_svc = (m.svc.round(3) - m.pred_service_min).abs().max()
    print(f"parity on {len(m):,} of {len(sub):,} submitted deliveries: max difference late probability {d_late:.1e}, "
          f"service minutes {d_svc:.1e}")
    if len(m) != len(sub) or d_late > 1e-5 or d_svc > 1e-3:
        raise SystemExit("PARITY FAILED: the installed model does not reproduce submission_task1.csv")
    print(f"PARITY OK: {model.version}. Set LATENESS_MODEL_DIR={args.out.resolve()}")


if __name__ == "__main__":
    main()
