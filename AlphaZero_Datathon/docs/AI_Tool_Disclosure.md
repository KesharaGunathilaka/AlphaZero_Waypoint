# AI tool disclosure · Datathon · Team AlphaZero

## Tools
* **Claude**, used as a coding and analysis assistant in the web app. It helped us to generate
  notebook cells which we ran manually. None of the CSVs were uploaded as-is. Only portions
  necessary for a particular notebook cell were given.
* **No AI model is part of the solution.** All predictive models are trained from scratch on the supplied data. No pre-trained model, no proprietary pre-processing API, and no AutoML or low-code modelling tool was used.

## What was AI-assisted
| Work | How AI was used |
|---|---|
| Python code | Written with Claude from our specifications; This also included the
matplotlib configuration at the top of the notebook cell. The final notebook was also given as a final correctness check and refactored |
| Task 1 | Our teammate's feature pipeline was refactored using AI. Functionality was preserved. Some charts and visualizations were added as a recommendation from Claude. Stricter validation was also added. |
| Task 2A analysis | Claude was used for the hyper-parameter checks. |
| Task 2B optimiser | The mixed-integer formulation, the lexicographic priority stages and the repair steps were generated according to our specifications. |
| Combining the three workstreams | Claude Code re-implemented the different teammates implementations into a single notebook which can run end-to-end. No added functionality. |
| Documents | First drafts of the preprocessing document, the written 2B policy, the decision log and this disclosure were drafted with AI and then edited by the team **[CONFIRM]** |

## What was not AI-assisted
The teammates' own original modelling ideas (the structural daily model and its leakage-tested features; the greedy priority score).
* Review of the label definitions against the competition booklet, the priority policy for the peak day, and the final decision about which model is used for each brand.
