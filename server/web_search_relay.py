import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

from flask import Response, g, request


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def register_web_search_relay(app):
    bundled = Path(__file__).with_name("web-relay-routes.json")
    routes_file = bundled if bundled.is_file() else (
        Path(__file__).resolve().parents[1] / "src/shared/services/web-search/web-relay-routes.json"
    )
    routes = json.loads(routes_file.read_text(encoding="utf-8"))
    opener = build_opener(ProxyHandler({}), NoRedirect())

    def reply(status, body):
        return Response(body, status, content_type="text/plain; charset=utf-8")

    @app.route("/web-search-relay/<route>", methods=["GET"], provide_automatic_options=False)
    def relay(route):
        if (request.method != "GET" or request.headers.get("X-Chatbox-Search") != "1"
                or request.headers.get("Sec-Fetch-Site", "same-origin") != "same-origin"
                or request.headers.get("Origin", g.external_origin) != g.external_origin):
            return reply(403, "Search relay requires a same-origin GET")
        upstream = routes.get(route)
        if upstream is None:
            return reply(404, "Unknown search relay route")
        query = request.args.get("q", "")
        if not query.strip() or len(query) > 1024 or len(list(request.args.items(multi=True))) != 1:
            return reply(400, "Invalid search query")
        target = upstream + ("&" if "?" in upstream else "?") + urlencode({"q": query})
        upstream_request = Request(target, headers={
            "Accept": "text/html",
            "Accept-Language": request.headers.get("Accept-Language", "")[:256] or "en-US,en;q=0.9",
            "User-Agent": request.headers.get("User-Agent", "")[:512] or "Chatbox Web Search",
        })
        limit = 2 * 1024 * 1024
        try:
            with opener.open(upstream_request, timeout=10) as response:
                body = response.read(limit + 1)
            if len(body) > limit:
                return reply(502, "Search response exceeded size limit")
            return reply(200, body)
        except HTTPError as error:
            error.close()
            return reply(502, f"Search upstream returned {error.code}")
        except TimeoutError:
            return reply(504, "Search upstream timed out")
        except URLError as error:
            if isinstance(error.reason, TimeoutError):
                return reply(504, "Search upstream timed out")
            return reply(502, "Search upstream request failed")
