// Command yt-dlp is a drop-in shim for the yt-dlp binary that LavaSrc's
// yt-dlp source spawns. It forwards argv to the Celeste resolver service
// (POST /v1/exec) and replays the result: stdout, stderr and exit code.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultResolverURL = "http://celeste-resolver:8080"
	requestTimeout     = 35 * time.Second
)

type execRequest struct {
	Args []string `json:"args"`
}

type execResponse struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

// run performs the call and returns the process exit code.
//
// stderr handling: LavaSrc starts the binary with redirectErrorStream(true),
// i.e. our stderr is merged into the stdout it parses as JSON. A real yt-dlp
// started with -q --no-warnings stays silent on success, so to keep the JSON
// parseable we only forward the resolver's stderr when exitCode != 0 (where
// LavaSrc just uses the merged text as the error message).
func run(args []string, resolverURL string, client *http.Client, stdout, stderr io.Writer) int {
	body, err := json.Marshal(execRequest{Args: args})
	if err != nil {
		fmt.Fprintf(stderr, "yt-dlp shim: encode request: %v\n", err)
		return 1
	}
	url := strings.TrimRight(resolverURL, "/") + "/v1/exec"
	resp, err := client.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		fmt.Fprintf(stderr, "yt-dlp shim: resolver request failed: %v\n", err)
		return 1
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Fprintf(stderr, "yt-dlp shim: read resolver response: %v\n", err)
		return 1
	}
	if resp.StatusCode != http.StatusOK {
		msg := strings.TrimSpace(string(data))
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		fmt.Fprintf(stderr, "yt-dlp shim: resolver returned HTTP %d: %s\n", resp.StatusCode, msg)
		return 1
	}
	var out execResponse
	if err := json.Unmarshal(data, &out); err != nil {
		fmt.Fprintf(stderr, "yt-dlp shim: decode resolver response: %v\n", err)
		return 1
	}
	_, _ = io.WriteString(stdout, out.Stdout)
	if out.ExitCode != 0 {
		_, _ = io.WriteString(stderr, out.Stderr)
	}
	return out.ExitCode
}

func main() {
	resolverURL := os.Getenv("RESOLVER_URL")
	if resolverURL == "" {
		resolverURL = defaultResolverURL
	}
	client := &http.Client{Timeout: requestTimeout}
	os.Exit(run(os.Args[1:], resolverURL, client, os.Stdout, os.Stderr))
}
