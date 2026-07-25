import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

def oss(mod):
    return os.getenv(mod)

# Map every model to its specific provider
MODEL_PROVIDER_MAP = {
    "deepseek-ai/deepseek-v4-flash": "nvidia",
    "deepseek-ai/deepseek-v4-pro": "nvidia",
    "z-ai/glm-5.2": "nvidia",
    "gemini-2.5-flash": "gemini",
    "gemini-3.0-flash": "gemini",
    "gemini-3.5-flash": "gemini",
    "openai/gpt-oss-20b": "groq",
    "llama-3.1-8b-instant": "groq",
    "llama-3.3-70b-versatile": "groq",
    "qwen/qwen3.6-27b": "groq",
}

# This list will be sent to the frontend dropdown
AVAILABLE_MODELS = list(MODEL_PROVIDER_MAP.keys())

def get_client_for_model(model_name):
    """Dynamically creates an OpenAI client based on the requested model."""
    provider = MODEL_PROVIDER_MAP.get(model_name)
    
    if not provider:
        raise ValueError(f"Unknown model selected: {model_name}")

    if provider == "gemini":

        base_url = oss("GEMINI_BASE_URL")

        api_key = oss("gemini")
    elif provider == "groq":
        
        base_url = oss("GROQ_BASE_URL")

        api_key = oss("groq")

    elif provider == "nvidia":

        base_url = oss("NVIDIA_BASE_URL")

        api_key = oss("nvidia")
    else:
        raise ValueError(f"Unknown provider configured: {provider}")

    if not base_url or not api_key:
        raise ValueError(f"Missing API key or Base URL in .env for provider: {provider}")

    # Return a fresh client configured for this specific model's provider
    return OpenAI(api_key=api_key, base_url=base_url)