import asyncio
import json
from dataclasses import replace

import pytest

from resolver.playback import is_playback, run_playback, stream_url, with_client
from resolver.runner import ExecResult

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
MWEB = ["--extractor-args", "youtube:player_client=mweb"]
PLAY = ["-q", "--no-warnings", "--format", "bestaudio", "-J", URL]


@pytest.fixture
def settings(settings):
    return replace(settings, exec_timeout_seconds=30)


def _gv(client: str) -> str:
    return f"https://rr1---sn-x.googlevideo.com/videoplayback?c={client}"


def test_is_playback():
    assert is_playback(PLAY)
    assert not is_playback(["-q", "--flat-playlist", "--skip-download", "-J", URL])
    assert not is_playback(["--format", "bestaudio", "-J", "ytsearch1:x"])


def test_with_client():
    assert with_client(PLAY, "default") == PLAY
    assert with_client(PLAY, "mweb") == [*PLAY[:-1], *MWEB, URL]
    pinned = [*PLAY[:-1], "--extractor-args", "youtube:player_client=web;skip=dash", URL]
    assert with_client(pinned, "default") == PLAY
    assert with_client(pinned, "mweb") == [*PLAY[:-1], *MWEB, URL]


def test_stream_url():
    assert stream_url(json.dumps({"url": _gv("x")})) == _gv("x")
    assert stream_url(json.dumps({"url": "https://evil.example/videoplayback"})) is None
    assert stream_url(json.dumps({"url": "http://rr1.googlevideo.com/x"})) is None
    assert stream_url("not json") is None
    assert stream_url("[]") is None


def _fake(statuses: dict[str, int | None], fail: tuple[str, ...] = ()):
    calls: list[list[str]] = []

    async def run(argv, _timeout):
        calls.append(argv)
        client = "mweb" if "youtube:player_client=mweb" in argv else "default"
        if client in fail:
            return ExecResult(1, "", "ERROR: boom\n")
        return ExecResult(0, json.dumps({"url": _gv(client)}), "")

    async def prober(url):
        return statuses[url.rsplit("=", 1)[1]]

    return calls, run, prober


def test_ok_first_try(settings):
    calls, run, prober = _fake({"default": 206})
    res = asyncio.run(run_playback(settings, PLAY, run, prober))
    assert calls == [PLAY] and _gv("default") in res.stdout


def test_falls_back_on_403(settings):
    calls, run, prober = _fake({"default": 403, "mweb": 206})
    res = asyncio.run(run_playback(settings, PLAY, run, prober))
    assert calls == [PLAY, with_client(PLAY, "mweb")]
    assert _gv("mweb") in res.stdout


def test_requested_client_tried_first_then_default(settings):
    pinned = with_client(PLAY, "mweb")
    calls, run, prober = _fake({"default": 206, "mweb": 403})
    res = asyncio.run(run_playback(settings, pinned, run, prober))
    assert calls == [pinned, PLAY]
    assert _gv("default") in res.stdout


def test_all_rejected_returns_first(settings):
    calls, run, prober = _fake({"default": 403, "mweb": 403})
    res = asyncio.run(run_playback(settings, PLAY, run, prober))
    assert len(calls) == 2 and _gv("default") in res.stdout


def test_ytdlp_error_falls_back(settings):
    calls, run, prober = _fake({"mweb": 206}, fail=("default",))
    res = asyncio.run(run_playback(settings, PLAY, run, prober))
    assert res.exit_code == 0 and _gv("mweb") in res.stdout


def test_probe_network_error_is_not_a_rejection(settings):
    calls, run, prober = _fake({"default": None})
    asyncio.run(run_playback(settings, PLAY, run, prober))
    assert calls == [PLAY]


def test_no_fallback_when_budget_spent(settings):
    calls, run, prober = _fake({"default": 403, "mweb": 206})
    s = replace(settings, exec_timeout_seconds=1)
    asyncio.run(run_playback(s, PLAY, run, prober))
    assert calls == [PLAY]


def test_api_skips_probe_when_disabled(settings):
    from fastapi.testclient import TestClient

    from resolver.main import create_app

    c = TestClient(create_app(replace(settings, playback_clients=())))
    r = c.post("/v1/exec", json={"args": ["-f", "bestaudio", "-J", URL]})
    assert r.status_code == 200 and r.json()["exitCode"] == 0
