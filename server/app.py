# # app.py
# import os
# import re
# from datetime import timedelta
# from flask import Flask
# from flask_cors import CORS

# app = Flask(__name__)

# app.config.update(
#     # MUST be stable across restarts. If this is regenerated on every boot,
#     # start.sh/stop.sh will silently log everyone out.
#     SECRET_KEY=os.environ["DECIDIO_SECRET_KEY"],

#     SESSION_COOKIE_NAME="decidio_session",
#     SESSION_COOKIE_HTTPONLY=True,     # JS cannot read it — including your own content script
#     SESSION_COOKIE_SAMESITE="None",   # required: extension origin != localhost
#     SESSION_COOKIE_SECURE=True,       # required alongside SameSite=None
#     PERMANENT_SESSION_LIFETIME=timedelta(days=30),
# )

# # Credentialed CORS cannot use "*". The Safari extension origin is a per-install
# # UUID, so match by scheme instead of listing IDs.
# CORS(
#     app,
#     supports_credentials=True,
#     origins=[
#         re.compile(r"^chrome-extension://[a-p]+$"),
#         re.compile(r"^safari-web-extension://.+$"),
#     ],
# )