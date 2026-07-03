import os
import sys

import uvicorn

if __name__ == "__main__":
    # Under `python -m src` the project ROOT is on sys.path, not `src/`.
    # Put the package dir first so `api:app` resolves the same way pytest does.
    sys.path.insert(0, os.path.dirname(__file__))
    uvicorn.run("api:app", host="0.0.0.0", port=8001, reload=False)
