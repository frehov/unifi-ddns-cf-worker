
from dataclasses import dataclass, InitVar, field
from typing import Optional, Any, Type
import httpx


class Cloudflare:

    def __init__(self, options: 'Options', *args, **kvargs):
        self.api_url = options.url
        self.token = options.token
        self.client = httpx.AsyncClient()

    def __await__(self):
            # Call the constructor and returns the instance
        print("async baby")
        return self.create().__await__()

    def __del__(self):
        print("destroying cloudflare api instance")

    @classmethod
    async def create(cls: Type['Cloudflare'], options: 'Options') -> 'Cloudflare':
        print("called create cloudflare client")
        return cls(options)
    
    async def zone(name: Optional[str] = None):
        query = {}
        if name:
            query['name'] = name
        response = await self.__fetch()

    async def __fetch(
        endpoint: str,
        headers: dict[str, Any],
        query: dict[str, Any],
        options: dict
    ):
        url = f"${self.cloudflare_url}/${endpoint}"
        pass

    @dataclass(kw_only=True)
    class Options:
        url: str = "https://api.cloudflare.com/client/v4"
        token: Optional[str] = field(default=None)

        def __await__(self):
            # Call the constructor and returns the instance
            return self.default().__await__()

        @classmethod
        async def default(cls: Type['Options'], token: str, ) -> 'Options':
            print("called create cloudflare client options")
            return cls(token = token)


