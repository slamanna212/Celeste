import pytest

from resolver.allowlist import DENIED_FLAGS, RejectedArgs, parse_args

URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Exact arg sets produced by LavaSrc 4.8.x (YtdlpAudioSourceManager defaults + getItem additions).
LAVASRC_SETS = [
    [
        "-q",
        "--no-warnings",
        "--flat-playlist",
        "--skip-download",
        "-J",
        "ytsearch10:never gonna give you up",
    ],
    ["-q", "--no-warnings", "--flat-playlist", "--skip-download", "-J", URL],
    [
        "-q",
        "--no-warnings",
        "--flat-playlist",
        "--skip-download",
        "-J",
        "--playlist-items",
        "1:25",
        URL + "&list=RDabc",
    ],
    [
        "-q",
        "--no-warnings",
        "--flat-playlist",
        "--skip-download",
        "-J",
        "--playlist-items",
        "1:500",
        URL + "&list=PLabc",
    ],
    ["-q", "--no-warnings", "-f", "bestaudio", "-J", URL],
    ["-q", "--no-warnings", "-f", "bestaudio", "-J", "https://youtu.be/dQw4w9WgXcQ"],
    ["-q", "--no-warnings", "-f", "bestaudio", "-J", "https://music.youtube.com/watch?v=abc"],
]


@pytest.mark.parametrize("args", LAVASRC_SETS)
def test_lavasrc_sets_accepted(args):
    parsed = parse_args(args, ("youtube.com", "youtu.be"))
    assert parsed.argv == [("--format" if a == "-f" else a) for a in args]
    assert parsed.positional == args[-1]


@pytest.mark.parametrize(
    "args",
    [
        ["--format=bestaudio", "-J", URL],
        ["--format", "bestaudio/best", "--dump-single-json", URL],
        ["--playlist-end=5", URL],
        ["--default-search", "ytsearch", URL],
        ["--extractor-args", "youtube:player_client=web", URL],
        ["--extractor-args=youtube:player_client=web;skip=dash", URL],
        ["-J", "ytmsearch5:daft punk"],
        ["--quiet", "--skip-download", "--flat-playlist", URL],
    ],
)
def test_other_valid_forms(args):
    parse_args(args, ("youtube.com", "youtu.be"))


def test_equals_form_normalised():
    assert parse_args(["--format=bestaudio", URL]).argv == ["--format", "bestaudio", URL]


@pytest.mark.parametrize("flag", sorted(DENIED_FLAGS))
def test_every_denied_flag_rejected(flag):
    for args in ([flag, "x", URL], [flag, URL], [f"{flag}=x", URL]):
        with pytest.raises(RejectedArgs):
            parse_args(args)


@pytest.mark.parametrize(
    "args",
    [
        ["--cookies-from-browser", "chrome", URL],
        ["--cookies=/etc/passwd", URL],
        ["--cookies-foo", URL],
        ["--postprocessor-command", "x", URL],
        ["--exec-command=ls", URL],
        ["-fbestaudio", URL],
        ["-qJ", URL],
        ["--", URL],
        ["-", URL],
        ["--no-such-flag", URL],
        ["--flat-playlis", URL],  # abbreviation
        ["-q=1", URL],
        ["-J=1", URL],
        ["-f"],
        ["-f", "-o", URL],
        ["--playlist-end", "abc", URL],
        ["--playlist-items", "1;rm", URL],
        ["--default-search", "http://x", URL],
        ["--extractor-args", "generic:foo=bar", URL],
        ["--extractor-args", "youtubepot-bgutilhttp:base_url=http://evil", URL],
        ["--extractor-args", "youtube", URL],
        ["--extractor-args", "YouTube:x=y", URL],
        [],
        ["-J"],
        [URL, URL],
        ["-J", "file:///etc/passwd"],
        ["-J", "/etc/passwd"],
        ["-J", "ftp://youtube.com/x"],
        ["-J", "ytsearch:no number"],
        ["-J", "ytsearch:"],
        ["-J", "scsearch5:x"],
        ["-J", "ytsearchall:x"],
        ["-J", "https://"],
        ["-J", "a\x00b"],
    ],
)
def test_rejected(args):
    with pytest.raises(RejectedArgs):
        parse_args(args)


def test_host_restriction():
    hosts = ("youtube.com", "youtu.be")
    parse_args(["-J", "https://m.youtube.com/watch?v=x"], hosts)
    for bad in (
        "https://evil.com/",
        "http://169.254.169.254/",
        "https://youtube.com.evil.com/",
        "https://notyoutube.com/",
        "https://youtube.com@evil.com/",
    ):
        with pytest.raises(RejectedArgs):
            parse_args(["-J", bad], hosts)
    parse_args(["-J", "https://evil.com/"], ("*",))


def test_too_many_and_too_long():
    with pytest.raises(RejectedArgs):
        parse_args(["-q"] * 100 + [URL])
    with pytest.raises(RejectedArgs):
        parse_args(["-J", "ytsearch1:" + "a" * 3000])
