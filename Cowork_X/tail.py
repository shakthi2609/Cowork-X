# To install: pip install tavily-python
from tavily import TavilyClient
client = TavilyClient("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")
response = client.search(
    query="who is the president of USA in 1870 ",
    search_depth="basic",
    include_answer= True
)
print(response)