import json
import logging
# from pyodide.ffi import JsProxy
from fastapi import FastAPI, Request
from pydantic import BaseModel
from typing import Annotated

from lib.cloudflare import Cloudflare as CF

async def on_fetch(request, env):
    import asgi

    return await asgi.fetch(app, request, env)

app = FastAPI()

@app.get("/")
async def root():
    return {"message": "Hello, World!"}

@app.get("/update")
async def update(req: Request):
    logger = logging.getLogger("test")
    print("print: testing update endpoint")
    options = await CF.Options.default(token="test-123")
    print(options)
    client = await CF.create(options)
    print(client)
    print(json.dumps(req.scope['env'].to_py()))
    pass

# TODO: what the fuck to do with this...
# class ComplexEncoder(json.JSONEncoder):
#     def default(self, obj):
#         if isinstance(obj, bytes):
#             return obj.decode()
#         if isinstance(obj, JsProxy):
#             return json.dumps(obj.to_py())
#         if isinstance(obj, FastAPI):
#             pass
#         # Let the base class default method raise the TypeError
#         return super().default(obj)