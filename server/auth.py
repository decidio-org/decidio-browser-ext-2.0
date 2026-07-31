# # auth.py
# from flask import Blueprint, request, jsonify, session
# from werkzeug.security import check_password_hash

# auth_bp = Blueprint("auth", __name__)

# # Replace with your real user store.
# USERS = {
#     "you@example.com": {
#         "id": 1,
#         "password_hash": "...",  # generate_password_hash("...")
#     },
# }


# @auth_bp.post("/api/login")
# def login():
#     data = request.get_json(silent=True) or {}
#     email = (data.get("email") or "").strip().lower()
#     password = data.get("password") or ""

#     user = USERS.get(email)
#     if not user or not check_password_hash(user["password_hash"], password):
#         # Same message for unknown email and wrong password.
#         return jsonify({"ok": False, "error": "Invalid email or password"}), 401

#     session.permanent = True          # opts into PERMANENT_SESSION_LIFETIME
#     session["user_id"] = user["id"]
#     session["email"] = email
#     return jsonify({"ok": True, "user": {"email": email}})


# @auth_bp.get("/api/me")
# def me():
#     if "user_id" not in session:
#         return jsonify({"authenticated": False}), 200
#     return jsonify({"authenticated": True, "user": {"email": session.get("email")}})


# @auth_bp.post("/api/logout")
# def logout():
#     session.clear()
#     return jsonify({"ok": True}), 200