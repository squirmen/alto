#!/usr/bin/env bash
# Waits for the metro current-state pipeline to finish, then auto-builds the timeseries
# (historic 2016 + 2013 CHMs -> change layers) from the already-downloaded LDS archives.
cd "$(dirname "$0")/.."
echo "$(date) orchestrator: waiting for metro current-state pipeline..."
while pgrep -f "make end-to-end-pilot" >/dev/null 2>&1; do sleep 120; done
echo "$(date) orchestrator: metro current-state pipeline ended"
if grep -q "Vector tiles ready" logs/metro_run.log; then
  echo "$(date) metro current-state OK -> building timeseries"
  AKL_TREES_PILOT=auckland_metro_v1 make historic-change HISTORIC_YEAR=2016 && echo "$(date) 2016 change done"
  AKL_TREES_PILOT=auckland_metro_v1 make build-historic-chm HISTORIC_YEAR=2013 && echo "$(date) 2013 historic CHM done"
  echo "$(date) metro timeseries complete"
else
  echo "$(date) metro current-state did NOT finish cleanly — skipping timeseries; review logs/metro_run.log"
fi
