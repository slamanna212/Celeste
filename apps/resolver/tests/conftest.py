import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from resolver.config import Settings
from resolver.main import create_app

FAKE = str(Path(__file__).parent / "fake_ytdlp.py")


@pytest.fixture
def settings(tmp_path):
    return Settings(
        pot_base_url="http://127.0.0.1:1",
        cookies_path=str(tmp_path / "cookies.txt"),
        exec_timeout_seconds=2,
        max_concurrency=2,
        allowed_url_hosts=("youtube.com", "youtu.be"),
        ytdlp_command=(sys.executable, FAKE),
    )


@pytest.fixture
def client(settings):
    return TestClient(create_app(settings))
