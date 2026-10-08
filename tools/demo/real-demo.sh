#!/usr/bin/env bash
# The demo / rehearsal on the REAL path, start to stop:
#   cd ~/Projects/wordlight && bash tools/demo/real-demo.sh
# 1. start the AWS server if it is stopped (idle auto-stop) and wait until it is healthy (TLS, real Transcribe, WSS)
# 2. build + launch the TV app on the Vega Virtual Device pointed at the AWS server (restart the VVD first if its
#    clock may have drifted: vega virtual-device stop && vega virtual-device start)
# 3. you run the story with the phone; press Enter at the end card → traces, latency and privacy audit are saved
# 4. the server is STOPPED again (answer n to keep it running)
set -uo pipefail
cd "$(dirname "$0")/../.."
bash tools/aws/phase-b.sh
read -r -p "Stop the AWS server now? [Y/n] " a
[ "${a:-Y}" = n ] || bash infra/aws/deploy.sh --stop
