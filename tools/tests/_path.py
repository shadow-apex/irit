import os
import sys

TOOLS = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if TOOLS not in sys.path:
    sys.path.insert(0, TOOLS)
