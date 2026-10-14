import json

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_exec_happy_path(client, settings, tmp_path):
    (tmp_path / "cookies.txt").write_text("# Netscape\n")
    r = client.post(
        "/v1/exec",
        json={"args": ["-q", "--no-warnings", "-f", "bestaudio", "-J", URL]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["exitCode"] == 0 and body["stderr"] == ""
    argv = json.loads(body["stdout"])["argv"]
    assert argv[-1] == URL
    assert "--cookies" in argv
    assert any(a.startswith("youtubepot-bgutilhttp:base_url=") for a in argv)


def test_exec_nonzero_exit(client):
    r = client.post("/v1/exec", json={"args": ["-J", "ytsearch1:fail"]})
    assert r.status_code == 200
    assert r.json() == {"exitCode": 1, "stdout": "", "stderr": "ERROR: boom\n"}


def test_exec_timeout(client, settings):
    from dataclasses import replace

    from fastapi.testclient import TestClient

    from resolver.main import create_app

    c = TestClient(create_app(replace(settings, exec_timeout_seconds=1)))
    r = c.post("/v1/exec", json={"args": ["-J", "ytsearch1:sleep"]})
    assert r.status_code == 200 and r.json()["exitCode"] == 124


def test_exec_rejects(client):
    for args in (["--exec", "ls", URL], ["-J", "https://evil.com/x"], ["-o", "x", URL]):
        r = client.post("/v1/exec", json={"args": args})
        assert r.status_code == 400
        assert "error" in r.json()


def test_exec_bad_body(client):
    assert client.post("/v1/exec", json={"nope": 1}).status_code == 400
    assert client.post("/v1/exec", json={"args": "x"}).status_code == 400


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_readyz_not_ready_without_pot(client):
    r = client.get("/readyz")
    assert r.status_code == 503
    assert r.json()["checks"]["pot"] is False


def test_readyz_ready(client, monkeypatch):
    monkeypatch.setattr("resolver.main._ping_pot", lambda _u: {"version": "2.0.2"})
    r = client.get("/readyz")
    assert r.status_code == 200 and r.json()["ready"] is True
    assert client.get("/v1/version").json()["potServer"] == "2.0.2"


def test_metrics(client):
    client.post("/v1/exec", json={"args": ["-J", URL]})
    text = client.get("/metrics").text
    assert "resolver_exec_requests_total" in text
    assert "resolver_exec_duration_seconds_bucket" in text
    assert "resolver_ytdlp_exit_codes_total" in text
