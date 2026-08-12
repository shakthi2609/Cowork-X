#==================================================================================================================
# ==========================
# Helpers (Diagram Logic)
# ==========================
import wikipediaapi
import re
import json
from tavily import TavilyClient
import os 
import dotenv 

dotenv.load_dotenv()

client = TavilyClient(os.getenv("TAVILY_WEB_CLIENT"))

# All supported Mermaid diagram types
MERMAID_DIAGRAM_TYPES = {
    # Flow / Graph
    'graph', 'flowchart', 'flow',
    # Diagrams
    'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
    'erDiagram', 'journey', 'gantt', 'pie', 'timeline',
    'gitgraph', 'gitGraph', 'requirementDiagram',
    # Mindmap / Other
    'mindmap', 'quadrantChart', 'xychart', 'block',
    'c4context', 'c4container', 'c4component', 'c4dynamic', 'c4deployment',
    'sankey', 'zenuml', 'kanban', 'packet',
}
#===============================================================================================================
# GET THE FIRST MERMIAD DIAGRAM RENDERED 
def extract_mermaid(text):
    """Extract the first ```mermaid ... ``` code block."""
    pattern = r"```mermaid\s*\n(.*?)\n```"
    match = re.search(pattern, text, re.DOTALL)
    return match.group(1).strip() if match else None


#====================================================================================================================
# this basicaly cleans the mermaid code,if user forgot to type the date , it fills em up so the renderer doesnt break ..and etcetra

def sanitize_diagram(code):
    """Sanitize a Mermaid diagram code block."""
    if not code:
        return code
    
    code = code.strip()
    diagram_type = detect_diagram_type(code)
    
    if not diagram_type:
        return code
    
    # --- Type-specific sanitization --- , like for flowchart , graph , if there's any error , find it and repair it so renderer doesnt break 
    if diagram_type.lower() in ('flowchart', 'graph', 'flow'):
        code = re.sub(r'^flowchart\s+', 'graph ', code, flags=re.IGNORECASE | re.MULTILINE)
        code = re.sub(r'^graph\s+BT\b', 'graph TD', code, flags=re.IGNORECASE | re.MULTILINE)
        code = re.sub(r'^graph\s+RL\b', 'graph LR', code, flags=re.IGNORECASE | re.MULTILINE)
    elif diagram_type.lower() == 'sequencediagram':
        pass
    elif diagram_type.lower() == 'gantt': # for the gantt format , this is the exact thing that replaces the date format . 
        if 'dateFormat' not in code.split('\n')[0]:
            lines = code.split('\n')
            if len(lines) > 1:
                lines.insert(1, 'dateFormat YYYY-MM-DD')
                code = '\n'.join(lines)
    elif diagram_type.lower() == 'pie':
        if 'showData' not in code:
            lines = code.split('\n')
            if len(lines) > 1:
                lines.insert(1, '    showData')
                code = '\n'.join(lines)
    elif diagram_type.lower() == 'mindmap':
        pass
    elif diagram_type.lower() == 'timeline':
        pass
    
    code = '\n'.join(line.rstrip() for line in code.split('\n'))
    code = re.sub(r'\n{3,}', '\n\n', code)
    
    return code


#===============================================================================================================

# IF THERE IS MORE THAN ONE DIAGRAM , THEN THIS WILL GET THE JOB DONE 
def extract_all_diagrams(text):
    """
    Extract ALL diagram code blocks from the response.
    Supports both ```mermaid and ```<diagramtype> code blocks.
    Returns a list of dicts: [{type: 'mermaid', code: '...'}, ...]
    """
    diagrams = []
    
    # Pattern 1: ```mermaid ... ``` blocks
    pattern1 = r"```mermaid\s*\n(.*?)\n```"
    for match in re.finditer(pattern1, text, re.DOTALL):
        diagrams.append({'type': 'mermaid', 'code': match.group(1).strip()})
    
    # Pattern 2: ```<diagramtype> ... ``` blocks (e.g. ```pie, ```mindmap, etc.)
    types_pattern = '|'.join(re.escape(t) for t in sorted(MERMAID_DIAGRAM_TYPES, key=len, reverse=True))
    pattern2 = rf"```({types_pattern})\s*\n(.*?)\n```"
    for match in re.finditer(pattern2, text, re.DOTALL):
        diagrams.append({'type': match.group(1), 'code': match.group(2).strip()})
    
    return diagrams
#===================================================================================================================

#==================================================================================================================
# DETECT DIAGRAM TYPE , LIKE PIE CHART , MINDMAP AND ETC
def detect_diagram_type(code):
    """Detect the Mermaid diagram type from the first line of code."""
    if not code:
        return None
    first_line = code.strip().split('\n')[0].strip()
    type_match = re.match(r'^(\w+)', first_line)
    if type_match:
        return type_match.group(1)
    return None

#=============================================================================


# ==========================
# Robust LaTeX Sanitization
# ==========================

def _find_matching_brace(text, start):
    if start >= len(text) or text[start] != '{':
        return start
    depth = 1
    i = start + 1
    while i < len(text) and depth > 0:
        if text[i] == '{':
            depth += 1
        elif text[i] == '}':
            depth -= 1
        i += 1
    return i if depth == 0 else start

def _is_outside_math(text, pos):
    count = 0
    i = 0
    while i < pos and i < len(text):
        if text[i] == '\\':
            i += 2
            continue
        if text[i] == '$':
            count += 1
        i += 1
    return count % 2 == '0'

def sanitize_latex(text):
    """Post-process the AI response to catch unformatted math and wrap it in $...$ delimiters."""
    if not isinstance(text, str):
        return ""   # or return text if you want to keep other types
    if not text:
        return text

    placeholders = {}
    counter = [0]

    def _protect_math(match):
        key = f'\x00M{counter[0]}\x00'
        counter[0] += 1
        placeholders[key] = match.group(0)
        return key

    text = re.sub(r'\$\$[\s\S]*?\$\$', _protect_math, text)
    text = re.sub(r'(?<!\$)\$[^\$\n]+\$(?!\$)', _protect_math, text)

    intervals_to_wrap = []
    i = 0
    while i < len(text):
        if text[i] != '\\':
            i += 1
            continue
        
        cmd_match = re.match(r'\\([a-zA-Z]+)', text[i:])
        if not cmd_match:
            i += 1
            continue
        
        cmd_name = cmd_match.group(1)
        cmd_end = i + len(cmd_match.group())
        
        known_commands = {
            'frac', 'sqrt', 'sum', 'int', 'prod', 'coprod', 'lim', 'vec',
            'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon',
            'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa',
            'lambda', 'mu', 'nu', 'xi', 'pi', 'varpi', 'rho', 'varrho',
            'sigma', 'varsigma', 'tau', 'upsilon', 'phi', 'varphi',
            'chi', 'psi', 'omega',
            'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma',
            'Upsilon', 'Phi', 'Psi', 'Omega',
            'infty', 'partial', 'nabla', 'hbar',
            'cup', 'cap', 'subset', 'supset', 'subseteq', 'supseteq',
            'in', 'notin', 'forall', 'exists',
            'rightarrow', 'leftarrow', 'Rightarrow', 'Leftarrow',
            'cdot', 'cdots', 'ldots', 'vdots', 'ddots',
            'mathbb', 'mathcal', 'mathbf', 'mathrm', 'mathit',
            'pm', 'mp', 'times', 'div', 'approx', 'neq', 'leq', 'geq',
            'sin', 'cos', 'tan', 'log', 'ln', 'exp', 'det', 'dim',
            'hat', 'tilde', 'bar', 'dot', 'ddot', 'widehat', 'widetilde',
            'begin', 'end','xrightarrow', 'xleftarrow', 'ce', 'chem', 'mathrm', 'textbf', 'textit', 'underline', 'overline'
        }
        
        if cmd_name not in known_commands and not cmd_name[0].isupper():
            i += 1
            continue
        
        j = cmd_end
        has_args = False
        while j < len(text) and text[j] == '{':
            brace_end = _find_matching_brace(text, j)
            if brace_end == j:
                break
            has_args = True
            j = brace_end
        
        if has_args and _is_outside_math(text, i):
            intervals_to_wrap.append((i, j))
            i = j
        else:
            i += 1

    for start, end in reversed(intervals_to_wrap):
        text = text[:start] + '$' + text[start:end] + '$' + text[end:]

    for key, value in placeholders.items():
        text = text.replace(key, value)

    text = re.sub(r'(?<!\$)([±×÷≠≈≤≥→←∑∫∏∂∇∞∈∀∃])(?!\$)', r'$\1$', text)

    return text

#===========================
# Wikipedia API Helpers
# ==========================

wiki_client = wikipediaapi.Wikipedia(
    user_agent='CoworkAI/1.0 (cowork@example.com)',
    language='en',
    extract_format=wikipediaapi.ExtractFormat.WIKI
)

def wikipedia_search(query, max_sentences=5):
    """Search Wikipedia for a given query and return a summary."""
    page = wiki_client.page(query)
    if not page.exists():
        return {
            "found": False,
            "error": f"No Wikipedia page found for '{query}'.",
            "query": query
        }
    
    summary_text = page.summary
    sentences = summary_text.split('. ')
    short_summary = '. '.join(sentences[:max_sentences])
    if len(sentences) > max_sentences:
        short_summary += '.'
    
    sections = []
    for section in page.sections:
        sections.append(section.title)
        if len(sections) >= 10:
            break
    
    return {
        "found": True,
        "title": page.title,
        "summary": short_summary,
        "full_summary": page.summary,
        "url": page.fullurl,
        "sections": sections,
        "query": query
    }

def wikipedia_search_suggestions(query, limit=5):
    """Search Wikipedia for pages matching the query."""
    import requests
    try:
        response = requests.get(
            "https://en.wikipedia.org/w/api.php",
            params={
                "action": "opensearch",
                "search": query,
                "limit": limit,
                "namespace": 0,
                "format": "json"
            },
            timeout=10
        )
        data = response.json()
        results = []
        if len(data) >= 4:
            for i in range(len(data[1])):
                results.append({
                    "title": data[1][i],
                    "description": data[2][i] if len(data) > 2 and i < len(data[2]) else "",
                    "url": data[3][i] if len(data) > 3 and i < len(data[3]) else ""
                })
        return {"results": results, "query": query}
    except Exception as e:
        return {"results": [], "query": query, "error": str(e)}



# ==========================
# Tool/Function Definitions for AI
# ==========================

TOOLS = [

    # In mermaid_and_utils.py, inside the TOOLS list, add:

    {
        "type": "function",
        "function": {
            "name": "tavily_web_search",
            "description": "Search the web using Tavily for current, up‑to‑date, and broad information. Use this for general knowledge questions, news, recent events, and when Wikipedia might be insufficient.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query"
                    },
                    "search_depth": {
                        "type": "string",
                        "enum": ["basic", "advanced"],
                        "description": "Depth of search; 'basic' is faster, 'advanced' is more thorough",
                        "default": "basic"
                    },
                    "include_answer": {
                        "type": "boolean",
                        "description": "Include a direct answer if available",
                        "default": True
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum number of results (1-10)",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 3
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "wikipedia_search",
            "description": "Search Wikipedia for a topic and get a summary of the article. Use this when the user asks for factual information, definitions, biographies, or any knowledge that Wikipedia would cover.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search term or topic to look up on Wikipedia"
                    },
                    "max_sentences": {
                        "type": "integer",
                        "description": "Maximum number of sentences to return (1-10)",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "wikipedia_search_suggestions",
            "description": "Search Wikipedia for page suggestions matching a query. Use this when the exact page is not found or the user asks for a list of related topics.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search term to find Wikipedia pages for"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of suggestions (1-10)",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 5
                    }
                },
                "required": ["query"]
            }
        }
    }
]

def execute_tool_call(tool_call):
    """Execute a tool/function call and return the result."""
    func_name = tool_call.function.name
    func_args = json.loads(tool_call.function.arguments)

    if func_name == "wikipedia_search":
        result = wikipedia_search(
            query=func_args.get("query", ""),
            max_sentences=func_args.get("max_sentences", 5)
        )
        return json.dumps(result, ensure_ascii=False)

    elif func_name == "wikipedia_search_suggestions":
        result = wikipedia_search_suggestions(
            query=func_args.get("query", ""),
            limit=func_args.get("limit", 5)
        )
        return json.dumps(result, ensure_ascii=False)

    elif func_name == "tavily_web_search":
        result = client.search(
            query=func_args.get("query", ""),
            search_depth=func_args.get("search_depth", "basic"),
            include_answer=func_args.get("include_answer", True),
            max_results=func_args.get("max_results", 3)
        )
        return json.dumps(result, ensure_ascii=False)
    else:

        return json.dumps({"error": f"Unknown function: {func_name}"})







# p5js

def extract_p5_code(reply):
    # Finds content inside ```p5 ... ``` blocks
    match = re.search(r'```p5\s*\n(.*?)\n```', reply, re.DOTALL)
    if match:
        return match.group(1).strip()
    return None
