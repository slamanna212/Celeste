"""Environment-driven settings (see docs/contracts.md)."""

from __future__ import annotations

import os
import shlex
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    return int(raw) if raw else default


@dataclass(frozen=True)
class Settings:
    pot_base_url: str = "http://127.0.0.1:4416"
    cookies_path: str = "/secrets/cookies.txt"
    exec_timeout_seconds: int = 30
    max_concurrency: int = 8
    port: int = 8080
    # Hosts (and their subdomains) a positional URL may point at. "*" allows any.
    allowed_url_hosts: tuple[str, ...] = ("youtube.com", "youtu.be")
    # Command prefix used to launch yt-dlp. Overridable for tests.
    ytdlp_command: tuple[str, ...] = field(default_factory=lambda: ("python", "-m", "yt_dlp"))
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> Settings:
        hosts = os.environ.get("ALLOWED_URL_HOSTS", "").strip()
        cmd = os.environ.get("YTDLP_COMMAND", "").strip()
        return cls(
            pot_base_url=os.environ.get("POT_BASE_URL", cls.pot_base_url).rstrip("/"),
            cookies_path=os.environ.get("COOKIES_PATH", cls.cookies_path),
            exec_timeout_seconds=_int("EXEC_TIMEOUT_SECONDS", 30),
            max_concurrency=max(1, _int("MAX_CONCURRENCY", 8)),
            port=_int("PORT", 8080),
            allowed_url_hosts=(
                tuple(h.strip().lower() for h in hosts.split(",") if h.strip())
                if hosts
                else cls.allowed_url_hosts
            ),
            ytdlp_command=tuple(shlex.split(cmd)) if cmd else ("python", "-m", "yt_dlp"),
            log_level=os.environ.get("LOG_LEVEL", "info").upper(),
        )
