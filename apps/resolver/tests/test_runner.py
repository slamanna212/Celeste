import asyncio
from dataclasses import replace

from resolver.runner import TIMEOUT_EXIT_CODE, build_command, run_ytdlp

URL = "https://youtu.be/abc"


def test_enforced_args_appended(settings):
    cmd = build_command(settings, ["-J", URL])
    assert cmd[-2:] == ["-J", URL]
    i = cmd.index("youtubepot-bgutilhttp:base_url=http://127.0.0.1:1")
    assert cmd[i - 1] == "--extractor-args"
    assert "--ignore-config" in cmd
    assert "--cookies" not in cmd


def test_cookies_only_if_exists(settings, tmp_path):
    assert "--cookies" not in build_command(settings, ["-J", URL])
    (tmp_path / "cookies.txt").write_text("# Netscape\n")
    cmd = build_command(settings, ["-J", URL])
    assert cmd[cmd.index("--cookies") + 1] == settings.cookies_path


def test_timeout_kills_and_returns_124(settings):
    s = replace(settings, exec_timeout_seconds=1)
    res = asyncio.run(run_ytdlp(s, ["-J", "ytsearch1:sleep"]))
    assert res.timed_out
    assert res.exit_code == TIMEOUT_EXIT_CODE
    assert "timed out" in res.stderr


def test_timeout_with_mocked_subprocess(settings, monkeypatch):
    killed = []

    class FakeProc:
        pid = 2**22 + 12345  # not a real pid
        returncode = None

        async def communicate(self):
            await asyncio.sleep(30)

        async def wait(self):
            return -9

        def kill(self):
            killed.append(True)

    async def fake_exec(*a, **k):
        return FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    s = replace(settings, exec_timeout_seconds=1)
    res = asyncio.run(run_ytdlp(s, ["-J", URL]))
    assert res.exit_code == 124 and killed
