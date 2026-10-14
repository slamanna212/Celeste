package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestForwardsArgsAndOutput(t *testing.T) {
	var got execRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/exec" {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"exitCode":0,"stdout":"{\"a\":1}","stderr":"noise"}`))
	}))
	defer srv.Close()

	var so, se bytes.Buffer
	args := []string{"-q", "-J", "ytsearch10:hello world"}
	code := run(args, srv.URL+"/", srv.Client(), &so, &se)
	if code != 0 || so.String() != `{"a":1}` || se.Len() != 0 {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, so.String(), se.String())
	}
	if !reflect.DeepEqual(got.Args, args) {
		t.Fatalf("args = %v", got.Args)
	}
}

func TestNonZeroExitForwardsStderr(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"exitCode":3,"stdout":"","stderr":"ERROR: boom"}`))
	}))
	defer srv.Close()
	var so, se bytes.Buffer
	code := run(nil, srv.URL, srv.Client(), &so, &se)
	if code != 3 || se.String() != "ERROR: boom" || so.Len() != 0 {
		t.Fatalf("code=%d stdout=%q stderr=%q", code, so.String(), se.String())
	}
}

func TestHTTPErrorStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "arg not allowed", http.StatusBadRequest)
	}))
	defer srv.Close()
	var so, se bytes.Buffer
	code := run([]string{"--exec", "x"}, srv.URL, srv.Client(), &so, &se)
	if code != 1 || !strings.Contains(se.String(), "400") || !strings.Contains(se.String(), "arg not allowed") {
		t.Fatalf("code=%d stderr=%q", code, se.String())
	}
}

func TestBadJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("not json"))
	}))
	defer srv.Close()
	var so, se bytes.Buffer
	if code := run(nil, srv.URL, srv.Client(), &so, &se); code != 1 || se.Len() == 0 {
		t.Fatalf("code=%d stderr=%q", code, se.String())
	}
}

func TestNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()
	var so, se bytes.Buffer
	if code := run(nil, url, &http.Client{Timeout: time.Second}, &so, &se); code != 1 || !strings.Contains(se.String(), "resolver request failed") {
		t.Fatalf("code=%d stderr=%q", code, se.String())
	}
}

func TestTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
	}))
	defer srv.Close()
	var so, se bytes.Buffer
	if code := run(nil, srv.URL, &http.Client{Timeout: 50 * time.Millisecond}, &so, &se); code != 1 {
		t.Fatalf("code=%d", code)
	}
}
