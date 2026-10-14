"""Stand-in for `python -m yt_dlp`: echoes its argv as JSON, or misbehaves on request."""

import json
import sys
import time

argv = sys.argv[1:]
if "ytsearch1:sleep" in argv:
    time.sleep(60)
if "ytsearch1:fail" in argv:
    sys.stderr.write("ERROR: boom\n")
    sys.exit(1)
print(json.dumps({"argv": argv}))
