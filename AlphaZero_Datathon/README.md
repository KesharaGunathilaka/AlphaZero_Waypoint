# AlphaZero · Datathon deliverables

| Deliverable | File |
|---|---|
| Final notebook (last cell = inference from the saved models for Task 1 and Task 2A, printing inputs and predictions) | `AlphaZero_FinalNotebook.ipynb` |
| Model files | **`models/task1_model.pkl`** (Task 1: 9 LightGBM boosters, i.e. lateness, log-target service and squared-error service, 3 seeds each, + the manifest with features, category levels and settings; the same models as LightGBM text files + `manifest.json` in `models/task1/`), `models/task2a_model.pkl` (hybrid GLM + LightGBM bundle), `models/task2a_structural.json` (structural daily model), `models/task2a_selection.json` (per-brand rule and validation scores) |
| Peak-day allocation and written policy | `submissions/submission_task2b.csv`, **`docs/Task2B_Prioritization_Policy.pdf`** |
| Prediction file, Task 2A | `submissions/submission_task2a.csv` (template columns and `row_id` order). |
| Architecture diagrams | **`docs/Architecture_Diagrams.pdf`** - the same diagrams as PNG in `docs/figures/architecture_*.png` |
| Data preprocessing document | **`docs/Data_Preprocessing.pdf`**; source `docs/Data_Preprocessing.md` |
| AI tool disclosure | **`docs/AI_Tool_Disclosure.md`** |
| Prediction file, Task 1 | `submissions/submission_task1.csv` (template columns and `delivery_id` order) |

## Headline results
* **Task 1** (three six-week time folds; two further folds that no decision used in brackets): service time **MAE
  3.90 min** (3.88) against 7.39 for the planning allowance; lateness **log loss 0.143, AUC 0.979** (0.140, 0.978),
  calibrated probabilities.
* **Task 2A**: 49 rolling origins × 10 weeks × 6 series. **3.12% WAPE on total volume and 2.07% on chilled** (seasonal naive
  7.72% / 6.65%). Fresh 1.91%, Style 5.44%, Tech 27.4% (random "as needed" ordering). P10–P90 ranges with 78–80% held-out coverage.
* **Task 2B**: 77 of 85 orders served (318.5 of 409.9 m³), 19 of 26 chilled orders, no outlet deferred two runs in a row,
  `check_allocation.py` PASSED.

## How to re-run
1. `pip install -r requirements.txt`
2. Put the supplied `data/` folder (General Data, Training Data, Test Data, Submission Templates) next to the notebook.
   The raw data are **not** included in this package.
3. Open `AlphaZero_FinalNotebook.ipynb`, Restart & Run All (about 35 minutes on a 16-core CPU: Task 1 about 20, mostly its configuration search; the
   Task 2A backtests run in parallel with results identical to a serial run; everything is seeded and deterministic).
   The notebook rewrites `models/`, `submissions/` and `outputs/task1/` (Task 1 experiment log).
