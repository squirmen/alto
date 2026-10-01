# Stage 3 CNN Calibration

Generated at: 2026-06-22T00:09:59+00:00

## Method

Saerens et al. 2002 post-hoc prior correction with 10 % uniform smoothing on the labelled-distribution prior. Adjusts CNN softmax outputs so the predicted distribution matches the expected Auckland species mix instead of the class-weighted training bias.

## Distributions

```json
{
  "calibration_method": "Saerens et al. 2002 prior correction with 10% uniform smoothing",
  "model_prior": {
    "evergreen_broadleaf": 0.17570203386853955,
    "deciduous_broadleaf": 0.06226659580873137,
    "conifer": 0.7066927762311974,
    "palm_other": 0.05533859409153173
  },
  "target_prior": {
    "evergreen_broadleaf": 0.39898116401197864,
    "deciduous_broadleaf": 0.23066815676402933,
    "conifer": 0.32006531834555796,
    "palm_other": 0.0502853608784341
  },
  "calibrated_distribution": {
    "evergreen_broadleaf": 452602,
    "deciduous_broadleaf": 186733,
    "conifer": 842363,
    "palm_other": 37573
  }
}
```
