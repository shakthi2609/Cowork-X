import os
import re
import json
from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from dotenv import load_dotenv
from syst import SYSTEM_PROMPT, DIAGRAM_FIX_SYSTEM_PROMPT
import wikipediaapi
import config  # Now uses dynamic get_client_for_model()
from mermaid_and_utils import *
from werkzeug.security import generate_password_hash, check_password_hash

load_dotenv()

app = Flask(__name__)
# Generate a secure fallback secret key if not provided in environment variables
app.secret_key = os.getenv("FLASK_SECRET_KEY", "cinderite1010_super_secret_session_key_9831")

# Create a secure hash of the password "cinderite1010" at app initialization
HASHED_PASSWORD = generate_password_hash("cinderite1010")

conversation_history = []

# ==========================
# Authentication Middleware & Routes
# ==========================

@app.before_request
def check_authentication():
    # Allow accessing static files, /login, and /logout without authentication
    if request.path.startswith('/static') or request.path in ['/login', '/logout']:
        return
    
    # If not authenticated, restrict access
    if not session.get('authenticated'):
        # For API routes, return a 401 Unauthorized JSON response
        if request.path in ['/chat', '/fix_diagram', '/wikipedia', '/get_models', '/new_chat']:
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        
        # For main page/browser routes, render the password screen
        return render_template("initiater.html")

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    password = data.get("password", "")
    
    if check_password_hash(HASHED_PASSWORD, password):
        session['authenticated'] = True
        return jsonify({"success": True})
    
    return jsonify({"success": False, "error": "Incorrect password. Please try again."})

@app.route("/logout", methods=["POST", "GET"])
def logout():
    session.clear()
    return jsonify({"success": True})

# ==========================
# Routes
# ==========================

@app.route("/")
def home():
    return render_template("mermaid.html")

# Send available models to the frontend dropdown
@app.route("/get_models", methods=["GET"])
def get_models():
    return jsonify({
        "success": True, 
        "models": config.AVAILABLE_MODELS
    })

@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    user_message = data.get("message", "")
    
    # Get model from frontend (injected by our JS script)
    selected_model = data.get("model", config.AVAILABLE_MODELS[0])

    try:
        # GET THE DYNAMIC CLIENT FOR THIS SPECIFIC MODEL
        client = config.get_client_for_model(selected_model)
    except ValueError as e:
        return jsonify({"success": False, "error": str(e)})

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    messages.extend(conversation_history)
    messages.append({"role": "user", "content": user_message})

    try:
        response = client.chat.completions.create(
            model=selected_model,
            messages=messages,
            temperature=0.7,
            tools=TOOLS,
            tool_choice="auto"
        )

        reply_message = response.choices[0].message
        
        tool_results = []
        if reply_message.tool_calls:
            messages.append(reply_message)
            
            for tool_call in reply_message.tool_calls:
                tool_result = execute_tool_call(tool_call)
                tool_results.append({
                    "name": tool_call.function.name,
                    "arguments": json.loads(tool_call.function.arguments),
                    "result": json.loads(tool_result)
                })
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": tool_result
                })
            
            response = client.chat.completions.create(
                model=selected_model,
                messages=messages,
                temperature=0.7
            )
            reply = response.choices[0].message.content or ""
        else:
            reply = reply_message.content or ""

        reply = sanitize_latex(reply)

        all_diagrams = extract_all_diagrams(reply)
        sanitized_diagrams = [{"type": d['type'], "code": sanitize_diagram(d['code'])} for d in all_diagrams]

        raw_mermaid = extract_mermaid(reply)
        mermaid_code = sanitize_diagram(raw_mermaid) if raw_mermaid else None

        # NEW: Extract p5.js simulation code
        p5_code = extract_p5_code(reply)

        conversation_history.append({"role": "user", "content": user_message})
        conversation_history.append({"role": "assistant", "content": reply})

        if len(conversation_history) > 40:
            del conversation_history[:-40]

        return jsonify ({
        "success": True,
        "response": reply,
        "mermaid": mermaid_code,
        "diagrams": sanitized_diagrams,
        "simulation": p5_code, # <--- Send this to your frontend
        "tool_calls": tool_results if tool_results else None
        
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

@app.route("/fix_diagram", methods=["POST"])
def fix_diagram():
    data = request.get_json()
    broken_code = data.get("code", "")
    error_message = data.get("error", "")
    selected_model = data.get("model", config.AVAILABLE_MODELS[0])

    if not broken_code:
        return jsonify({"success": False, "error": "No diagram code provided"})

    try:
        # GET THE DYNAMIC CLIENT FOR FIXING DIAGRAMS TOO
        client = config.get_client_for_model(selected_model)
        
        messages = [
            {"role": "system", "content": DIAGRAM_FIX_SYSTEM_PROMPT},
            {"role": "user", "content": f"The following Mermaid diagram failed to render with error: {error_message}\n\nBroken diagram code:\n```\n{broken_code}\n```\n\nPlease fix the diagram code and return ONLY the corrected Mermaid code."}
        ]

        response = client.chat.completions.create(
            model=selected_model,
            messages=messages,
            temperature=0.3
        )

        fixed_code = response.choices[0].message.content.strip()
        fixed_code = re.sub(r'^```(?:mermaid)?\s*\n?', '', fixed_code)
        fixed_code = re.sub(r'\n?```\s*$', '', fixed_code).strip()

        if not fixed_code:
            return jsonify({"success": False, "error": "AI returned empty fix"})

        return jsonify({"success": True, "fixed_code": fixed_code})

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"success": False, "error": str(e)})

@app.route("/new_chat", methods=["POST"])
def new_chat():
    global conversation_history
    conversation_history = []
    return jsonify({"success": True})

@app.route("/wikipedia", methods=["POST"])
def wikipedia_route():
    data = request.get_json()
    query = data.get("query", "")
    mode = data.get("mode", "search")
    max_sentences = data.get("max_sentences", 5)
    limit = data.get("limit", 5)
    
    if not query:
        return jsonify({"success": False, "error": "No query provided"})
    
    try:
        if mode == "suggestions":
            result = wikipedia_search_suggestions(query, limit)
        else:
            result = wikipedia_search(query, max_sentences)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

if __name__ == "__main__":
    print(f"Running Server... UI will handle model selection.")
    app.run(host="0.0.0.0", port=5000, debug=True)