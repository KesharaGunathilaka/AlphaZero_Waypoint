"""Our Datathon Task 1 model (service time and lateness), run on Waypoint's plans.

The feature code below is the notebook's (AlphaZero_FinalNotebook.ipynb §5), kept line for line so the
numbers can be defended the same way: the plan itself, as-of history and the ETA replay. Nothing is
retrained here. The nine LightGBM files and manifest.json are the ones saved in §7.3, and the history
statistics are the ones the submission used (cutoff 16 Feb 2026), built by scripts/install_lateness_model.py.
The competition data and anything derived from it stay out of the repository, so the API reads both from
LATENESS_MODEL_DIR and simply shows no predictions when it is not set.

scripts/install_lateness_model.py reruns the Datathon test set through this file and requires the
submitted probabilities back (submission_task1.csv), so this is provably the model we were scored on.
"""

import gzip
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

SMOOTH_M = 10          # pseudo-rows shrinking outlet means toward their brand x dock x monsoon prior
CAT_COLS = ["brand", "dock_type", "district", "depot", "vehicle_type", "vehicle_temp",
            "parking_constraint", "temp_requirement"]
# History is 0 to 41 days old everywhere the model was trained and scored (six-week blocks, §5). Our history
# ends on the Datathon cutoff, so in production the age is held at the oldest value the model has seen.
MAX_CUTOFF_AGE_DAYS = 41
HISTORY_FILE = "history.json.gz"


# ------------------------------------------------------------------ plan features (§5, add_static_features)
def add_static_features(df: pd.DataFrame, ref: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Prediction-time features: order record, planned route, reference tables, calendar."""
    d = df.copy()
    d["date_str"] = d["date"].dt.strftime("%Y-%m-%d")
    calendar = ref["calendar"][["date", "is_payday", "festival_ramp", "is_holiday"]].rename(columns={"date": "date_str"})
    d = d.merge(calendar, on="date_str", how="left", validate="many_to_one")
    d["month"] = d["date"].dt.month
    # traffic at the leg's planned departure hour, and date-specific road disruption
    d["leg_hour"] = (d["planned_depart_min"] // 60).astype(int)
    d = d.merge(ref["traffic"].rename(columns={"hour": "leg_hour"}), on=["district", "leg_hour", "monsoon"],
                how="left", validate="many_to_one")
    d = d.merge(ref["road"].rename(columns={"date": "date_str"}), on=["district", "date_str"], how="left", validate="many_to_one")
    d["phys_travel_nd"] = d["planned_travel_duration_min"] * 100.0 / d["speed_index"]
    d["phys_travel"] = d["phys_travel_nd"] * 100.0 / d["disruption_index"]
    # outlet / vehicle attributes
    o = ref["outlets"][["outlet_id", "mall_window"]].assign(is_mall=lambda x: x.mall_window.notna().astype(int))
    d = d.merge(o[["outlet_id", "is_mall"]], on="outlet_id", how="left", validate="many_to_one")
    d = d.merge(ref["vehicles"][["vehicle_id", "weight_cap_kg", "volume_cap_m3"]], on="vehicle_id", how="left",
                validate="many_to_one")
    # order size
    d["log_units"], d["log_kg"], d["log_m3"] = np.log1p(d["order_units"]), np.log1p(d["order_weight_kg"]), np.log1p(d["order_volume_m3"])
    d["kg_per_unit"] = d["order_weight_kg"] / d["order_units"].clip(lower=1)
    d["m3_per_unit"] = d["order_volume_m3"] / d["order_units"].clip(lower=1)
    d["is_chilled"] = d["temp_requirement"].eq("chilled").astype(int)
    d["is_van_only"] = d["parking_constraint"].eq("van_only").astype(int)
    d["is_deferred"] = d["dispatch_status"].eq("deferred").astype(int)
    d["same_outlet_leg"] = d["from_point"].eq(d["to_outlet"]).astype(int)
    # route structure (the whole planned route is known before departure)
    d = d.sort_values(["route_id", "seq"])
    g = d.groupby("route_id", sort=False)
    d["seq_frac"] = d["seq"] / (d["n_stops"] - 1).clip(lower=1)
    d["stops_remaining"] = d["n_stops"] - 1 - d["seq"]
    d["route_start_min"] = g["planned_depart_min"].transform("first")
    d["elapsed_planned_min"] = d["planned_arrival_min"] - d["route_start_min"]
    d["cum_distance_km"] = g["distance_km"].cumsum()
    d["route_distance_km"] = g["distance_km"].transform("sum")
    d["cum_planned_travel"] = g["planned_travel_duration_min"].cumsum()
    d["upstream_allowance"] = g["service_allowance_min"].cumsum() - d["service_allowance_min"]
    d["route_load_m3_frac"] = g["order_volume_m3"].transform("sum") / d["volume_cap_m3"]
    d["route_load_kg_frac"] = g["order_weight_kg"].transform("sum") / d["weight_cap_kg"]
    d["cum_phys_over"] = (d["phys_travel"] - d["planned_travel_duration_min"]).groupby(d["route_id"]).cumsum()
    d["cum_phys_over_nd"] = (d["phys_travel_nd"] - d["planned_travel_duration_min"]).groupby(d["route_id"]).cumsum()
    # window
    d["window_len"] = d["window_close_min"] - d["window_open_min"]
    d["planned_slack_min"] = d["window_close_min"] - d["planned_arrival_min"]
    d["planned_wait_min"] = (d["window_open_min"] - d["planned_arrival_min"]).clip(lower=0)
    d["planned_arrival_hour"] = (d["planned_arrival_min"] // 60).astype(int)
    d["seq_c"] = d["seq"].clip(upper=8)
    d["brand_dock"] = d["brand"] + "|" + d["dock_type"]
    return d.sort_index()


# ---------------------------------------------------------------- as-of history (§5, add_history_features)
# Each block: the keys it groups by and the statistics it keeps. Built once from the labelled Datathon rows
# dated before the cutoff (build_history); joined here exactly as _asof joins them in the notebook.
HISTORY_BLOCKS = {
    "h_out_": ["outlet_id"],
    "h_outm_": ["outlet_id", "monsoon"],
    "h_out_recent_": ["outlet_id"],
    "h_bdm_": ["brand_dock", "monsoon"],
    "h_veh_": ["vehicle_id"],
    "h_dsm_": ["district", "seq_c", "monsoon"],
    "h_dist_": ["district", "monsoon"],
    "h_depot_": ["depot"],
    "size:h_out_": ["outlet_id"],
    "size:h_bd_": ["brand_dock"],
}


def build_history(hist: pd.DataFrame, cutoff: pd.Timestamp, recent_days: int = 84) -> dict:
    """The as-of statistics for one cutoff, in the notebook's _asof terms (rows dated strictly before it)."""
    h = hist[hist["date"] < cutoff]
    svc_aggs = dict(n=("service_min", "size"), svc_mean=("service_min", "mean"), svc_med=("service_min", "median"),
                    svc_lmean=("log_svc", "mean"), svc_std=("service_min", "std"), late=("is_late", "mean"))
    specs = {
        "h_out_": (svc_aggs, None, None),
        "h_outm_": (dict(n=("service_min", "size"), svc_mean=("service_min", "mean"), svc_med=("service_min", "median"),
                         late=("is_late", "mean")), None, None),
        "h_out_recent_": (dict(n=("service_min", "size"), svc_mean=("service_min", "mean")), recent_days, None),
        "h_bdm_": (dict(svc_mean=("service_min", "mean"), svc_med=("service_min", "median")), None, None),
        "h_veh_": (dict(svc_mean=("service_min", "mean"), late=("is_late", "mean")), None, None),
        "h_dsm_": (dict(n=("is_late", "size"), late=("is_late", "mean")), None, None),
        "h_dist_": (dict(ratio=("travel_ratio", "mean"), ratio_nd=("travel_ratio_nd", "mean"),
                         ratio_sd=("travel_ratio", "std")), None, None),
        "h_depot_": (dict(start_delay=("start_delay", "mean")), None, lambda x: x["seq"].eq(0)),
        "size:h_out_": (dict(pu=("svc_per_unit", "median"), pk=("svc_per_kg", "median")), None, None),
        "size:h_bd_": (dict(pu=("svc_per_unit", "median"), pk=("svc_per_kg", "median")), None, None),
    }
    out = {"cutoff": str(cutoff.date()), "blocks": {}}
    for name, (aggs, window_days, filt) in specs.items():
        keys = HISTORY_BLOCKS[name]
        x = h
        if window_days:
            x = x[x["date"] >= cutoff - pd.Timedelta(days=window_days)]
        if filt is not None:
            x = x[filt(x)]
        t = x.groupby(keys, observed=True).agg(**aggs).reset_index()
        out["blocks"][name] = {"keys": keys, "columns": list(aggs), "rows": t.astype(object).where(t.notna(), None).values.tolist()}
    # Waypoint orders count shelf items; the Datathon's order_units are handling units (cases). The scorer converts
    # an order's weight to cases with the median kg per case for its brand and temperature.
    kpu = (h["order_weight_kg"] / h["order_units"].clip(lower=1)).groupby([h["brand"], h["temp_requirement"]]).median()
    out["kg_per_unit"] = {f"{b}|{t}": float(v) for (b, t), v in kpu.items()}
    return out


def _join(rows: pd.DataFrame, block: dict, prefix: str) -> pd.DataFrame:
    keys, cols = block["keys"], block["columns"]
    t = pd.DataFrame(block["rows"], columns=keys + cols)
    for c in cols:
        t[c] = pd.to_numeric(t[c], errors="coerce").astype(float)
    for k in keys:
        if pd.api.types.is_numeric_dtype(rows[k]):
            t[k] = t[k].astype(rows[k].dtype)
    return rows[keys].join(t.set_index(keys), on=keys).drop(columns=keys).add_prefix(prefix)


def add_history_features(rows: pd.DataFrame, history: dict, dates_cutoff: pd.Series) -> pd.DataFrame:
    d = rows.copy()
    b = history["blocks"]
    d = pd.concat([d] + [_join(d, b[name], name) for name in
                         ["h_out_", "h_outm_", "h_out_recent_", "h_bdm_", "h_veh_", "h_dsm_", "h_dist_", "h_depot_"]], axis=1)
    # shrink the outlet x monsoon mean toward its brand x dock x monsoon prior (empirical Bayes)
    prior = d["h_bdm_svc_mean"].fillna(d["service_allowance_min"])
    n = d["h_outm_n"].fillna(0)
    d["h_outm_svc_mean_sm"] = (n * d["h_outm_svc_mean"].fillna(0) + SMOOTH_M * prior) / (n + SMOOTH_M)
    d["h_out_vs_allowance"] = d["h_out_svc_mean"] / d["service_allowance_min"]
    d["h_cutoff_age_days"] = (d["date"] - dates_cutoff).dt.days
    # size-scaled history: outlet and brand x dock median minutes per unit and per kg
    size = pd.concat([_join(d, b["size:h_out_"], "h_out_"), _join(d, b["size:h_bd_"], "h_bd_")], axis=1)
    d = pd.concat([d, size], axis=1)
    d["h_size_exp_units"] = d["h_out_pu"].fillna(d["h_bd_pu"]) * d["order_units"]
    d["h_size_exp_kg"] = d["h_out_pk"].fillna(d["h_bd_pk"]) * d["order_weight_kg"]
    return d


# ------------------------------------------------------------------------- ETA replay (§5, add_eta_features)
def add_eta_features(df, use_disruption=True, exp_svc=None, prefix="eta_", live=False):
    """Replay each planned route stop by stop: expected departure delay at the depot, expected travel per leg
    (traffic x road disruption x the district's historical travel ratio), waits for windows to open, and expected
    service at each stop (default: the outlet x monsoon history mean). Output columns are named with `prefix`.

    Waypoint addition, for Live only (live=True): the replay follows the van. `start_delay` (minutes) replaces the
    depot's average start delay once it has left (or is late leaving); `live_arrival_min` is a stop's reported
    arrival, `live_leave_min` the time the van really left the stop before, and `live_not_before_min` the present
    for a stop not reached yet (it cannot be reached in the past). NaN where unknown. With live=False the replay
    is the notebook's."""
    d = df.sort_values(["route_id", "seq"]).copy()
    if use_disruption:
        exp_travel = d["phys_travel"] * d["h_dist_ratio"].fillna(1.087)
    else:
        exp_travel = d["phys_travel_nd"] * d["h_dist_ratio_nd"].fillna(d["h_dist_ratio_nd"].median())
    exp_svc = (d["h_outm_svc_mean_sm"] if exp_svc is None else pd.Series(exp_svc, index=df.index).loc[d.index]).to_numpy()
    delay = d["h_depot_start_delay"].fillna(7.7)
    if live:
        delay = d["start_delay"].fillna(delay)
    start_delay = delay.to_numpy()
    nan = np.full(len(d), np.nan)
    real_arr, real_leave, not_before = ((d[c].to_numpy(dtype=float) if live else nan)
                                        for c in ("live_arrival_min", "live_leave_min", "live_not_before_min"))
    seq, rid = d["seq"].to_numpy(), d["route_id"].to_numpy()
    prev_leave = pd.Series(np.nan, index=pd.unique(rid))
    eta = np.empty(len(d))
    for k in range(int(seq.max()) + 1):
        m = seq == k
        dep = d["planned_depart_min"].to_numpy()[m] + start_delay[m] if k == 0 else prev_leave.loc[rid[m]].to_numpy()
        dep = np.where(np.isnan(real_leave[m]), dep, real_leave[m])
        arr = dep + exp_travel.to_numpy()[m]
        arr = np.where(np.isnan(real_arr[m]), np.fmax(arr, not_before[m]), real_arr[m])
        start = np.maximum(arr, d["window_open_min"].to_numpy()[m])
        eta[m] = arr
        prev_leave.loc[rid[m]] = start + exp_svc[m]
    p = prefix
    d[p + "min"] = eta
    d[p + "delay_min"] = eta - d["planned_arrival_min"]
    d[p + "slack_min"] = d["window_close_min"] - eta
    d[p + "wait_min"] = np.maximum(0, d["window_open_min"] - eta)
    d[p + "slack_per_sd"] = d[p + "slack_min"] / (d["h_dist_ratio_sd"].fillna(0.26) * d["cum_planned_travel"]).clip(lower=5)
    return d.sort_index()


def build_features(rows, history, cutoffs, size_eta_weight=0.5, live=False):
    """t1_build_features with the road disruption variant the final model uses."""
    d = add_history_features(rows, history, cutoffs)
    d = add_eta_features(d, live=live)
    # size-aware replay: expected service = weighted blend of the outlet mean and minutes-per-unit x order units
    o = d["h_outm_svc_mean_sm"]
    exp_size = size_eta_weight * d["h_size_exp_units"].fillna(o) + (1 - size_eta_weight) * o
    return add_eta_features(d, exp_svc=exp_size, prefix="eta2_", live=live)


# --------------------------------------------------------------------------------------------- the model
@dataclass
class Task1Model:
    manifest: dict
    models: dict[str, list[lgb.Booster]]
    history: dict
    fingerprint: str  # sha256 of the files, so a stored prediction names exactly what produced it

    @property
    def version(self) -> str:
        return f"datathon-task1 {self.manifest['created'][:10]} {self.fingerprint[:8]}"

    @classmethod
    def load(cls, model_dir: str | Path) -> "Task1Model":
        model_dir = Path(model_dir)
        manifest = json.loads((model_dir / "manifest.json").read_text())
        digest = hashlib.sha256()
        models = {}
        for kind, files in manifest["files"].items():
            models[kind] = []
            for f in files:
                text = (model_dir / f).read_text()
                digest.update(text.encode())
                models[kind].append(lgb.Booster(model_str=text))
        with gzip.open(model_dir / HISTORY_FILE, "rt", encoding="utf-8") as fh:
            history = json.load(fh)
        return cls(manifest, models, history, digest.hexdigest())

    def frame(self, df: pd.DataFrame, kind: str) -> pd.DataFrame:
        feats = self.manifest["features"]["late" if kind == "late" else "service"]
        X = df[feats].copy()
        for c in CAT_COLS:
            if c in X.columns:
                X[c] = pd.Categorical(X[c], categories=self.manifest["categories"][c])
        return X

    def features(self, rows: pd.DataFrame, cutoffs: pd.Series | None = None, live: bool = False) -> pd.DataFrame:
        if cutoffs is None:  # production: the history's own cutoff, its age held at what the model has seen
            cutoffs = rows["date"] - pd.to_timedelta(
                (rows["date"] - pd.Timestamp(self.history["cutoff"])).dt.days.clip(upper=MAX_CUTOFF_AGE_DAYS), unit="D")
        return build_features(rows, self.history, cutoffs, self.manifest["size_eta_weight"], live)

    def predict(self, feats: pd.DataFrame) -> pd.DataFrame:
        """§7: three seeds averaged; service = 0.75 x log-target model + 0.25 x squared-error model."""
        w = self.manifest["blend_weight_log_model"]
        X_late, X_svc = self.frame(feats, "late"), self.frame(feats, "service")
        p_late = np.clip(np.mean([m.predict(X_late) for m in self.models["late"]], axis=0), 0, 1)
        p_log = np.mean([np.expm1(m.predict(X_svc)) for m in self.models["svc_l2log"]], axis=0)
        p_l2 = np.mean([m.predict(X_svc) for m in self.models["svc_l2"]], axis=0)
        p_svc = np.clip(w * p_log + (1 - w) * p_l2, 0.5, None)
        return pd.DataFrame({"p_late": p_late, "p_svc": p_svc}, index=feats.index)
