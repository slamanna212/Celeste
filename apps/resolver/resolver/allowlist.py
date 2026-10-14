"""Strict yt-dlp argument allowlist.

Only the argument shapes LavaSrc's yt-dlp source manager (4.8.x) produces are
accepted. Everything else is rejected with a ``RejectedArgs`` carrying a
human-readable message (surfaced as HTTP 400).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

MAX_ARGS = 64
MAX_ARG_LEN = 2048

# Flags that take no value.
BOOLEAN_FLAGS = frozenset(
    {
        "-q",
        "--quiet",
        "--no-warnings",
        "--flat-playlist",
        "--skip-download",
        "-J",
        "--dump-single-json",
    }
)

_FORMAT_RE = re.compile(r"^[^\s\-][^\x00-\x1f]{0,199}$")
_INT_RE = re.compile(r"^[0-9]{1,5}$")
_ITEMS_RE = re.compile(r"^[0-9:,\-]{1,200}$")
_DEFAULT_SEARCH_RE = re.compile(r"^[a-z]{1,16}[0-9]{0,3}$")
_SEARCH_RE = re.compile(r"^(?:ytsearch|ytmsearch)[0-9]{1,3}:[^\x00]+$")


def _validate_format(v: str) -> bool:
    return bool(_FORMAT_RE.match(v))


def _validate_extractor_args(v: str) -> bool:
    return v.startswith("youtube:") and len(v) > len("youtube:") and "\x00" not in v


# flag -> (canonical name, validator). Short and long forms share validators.
VALUE_FLAGS = {
    "-f": ("--format", _validate_format),
    "--format": ("--format", _validate_format),
    "--playlist-end": ("--playlist-end", lambda v: bool(_INT_RE.match(v))),
    "--playlist-items": ("--playlist-items", lambda v: bool(_ITEMS_RE.match(v))),
    "--default-search": ("--default-search", lambda v: bool(_DEFAULT_SEARCH_RE.match(v))),
    "--extractor-args": ("--extractor-args", _validate_extractor_args),
}

# Explicitly denied (for a clearer error). Anything unknown is rejected too.
DENIED_FLAGS = frozenset(
    {
        "--exec",
        "--exec-before-download",
        "-o",
        "--output",
        "-P",
        "--paths",
        "--config-location",
        "--config-locations",
        "--plugin-dirs",
        "--cookies",
        "--cookies-from-browser",
        "--load-info-json",
        "--load-info",
        "-a",
        "--batch-file",
        "--proxy",
        "--netrc-cmd",
        "--use-postprocessor",
        "--print-to-file",
        "--download-archive",
        "--cache-dir",
        "--js-runtimes",
        "--remote-components",
        "--enable-file-urls",
    }
)


class RejectedArgs(ValueError):
    """Raised when the argument list violates the allowlist."""


@dataclass(frozen=True)
class ParsedArgs:
    argv: list[str]  # normalised, safe to pass to yt-dlp (without enforced args)
    positional: str


def _is_denied(name: str) -> bool:
    return name in DENIED_FLAGS or name.startswith("--cookies") or name.endswith("-command")


def _check_target(target: str, allowed_hosts: tuple[str, ...]) -> None:
    if _SEARCH_RE.match(target):
        return
    lowered = target.lower()
    if lowered.startswith(("http://", "https://")):
        try:
            host = (urlsplit(target).hostname or "").lower()
        except ValueError as exc:
            raise RejectedArgs(f"invalid URL: {exc}") from exc
        if not host:
            raise RejectedArgs("URL has no host")
        if "*" in allowed_hosts or any(host == h or host.endswith("." + h) for h in allowed_hosts):
            return
        raise RejectedArgs(f"URL host {host!r} is not allowed")
    raise RejectedArgs("positional argument must be an http(s) URL or ytsearchN:/ytmsearchN: query")


def parse_args(args: list[str], allowed_hosts: tuple[str, ...] = ("*",)) -> ParsedArgs:
    if len(args) > MAX_ARGS:
        raise RejectedArgs(f"too many arguments (max {MAX_ARGS})")
    out: list[str] = []
    positional: str | None = None
    i = 0
    while i < len(args):
        tok = args[i]
        i += 1
        if len(tok) > MAX_ARG_LEN:
            raise RejectedArgs("argument too long")
        if "\x00" in tok:
            raise RejectedArgs("NUL byte in argument")
        if not tok.startswith("-") or tok == "-":
            if tok == "-":
                raise RejectedArgs("'-' is not allowed")
            if positional is not None:
                raise RejectedArgs("exactly one positional URL/query is allowed")
            positional = tok
            continue

        if tok.startswith("--"):
            name, eq, inline = tok.partition("=")
        else:
            name, eq, inline = tok, "", ""
        if name == "--":
            raise RejectedArgs("'--' is not allowed")

        if name in BOOLEAN_FLAGS:
            if eq:
                raise RejectedArgs(f"flag {name} does not take a value")
            out.append(name)
        elif name in VALUE_FLAGS:
            canon, validate = VALUE_FLAGS[name]
            if eq:
                value = inline
            else:
                if i >= len(args):
                    raise RejectedArgs(f"flag {name} requires a value")
                value = args[i]
                i += 1
            if not validate(value):
                raise RejectedArgs(f"invalid value for {name}")
            out.extend([canon, value])
        elif _is_denied(name):
            raise RejectedArgs(f"flag {name} is explicitly denied")
        else:
            raise RejectedArgs(f"flag {tok.split('=', 1)[0]} is not in the allowlist")

    if positional is None:
        raise RejectedArgs("exactly one positional URL/query is required")
    _check_target(positional, allowed_hosts)
    out.append(positional)
    return ParsedArgs(argv=out, positional=positional)
