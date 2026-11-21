package engine

import (
	"context"
	"encoding/json"
	"sync"

	"movieapi/internal/core"
	"movieapi/internal/providers"
)

type Error struct {
	Code string `json:"code"`
	Msg  string `json:"message"`
}

func (e *Error) Error() string { return e.Msg }

type Config struct {
	Domains struct {
		Cinemeta string `json:"cinemeta"`
	} `json:"domains"`
}

type Engine struct {
	reg *providers.Registry
}

func New(raw json.RawMessage) (*Engine, error) {
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return &Engine{
		reg: providers.NewReg(providers.NewCinemeta(cfg.Domains.Cinemeta)),
	}, nil
}

type SearchResponse struct {
	core.SearchResult
	Errors map[string]string `json:"errors,omitempty"`
}

func (e *Engine) Srch(ctx context.Context, q, kind, source string, limit, offset int) (SearchResponse, error) {
	targets := e.reg.Cfgd()
	if source != "" {
		p, ok := e.reg.Get(source)
		if !ok {
			return SearchResponse{}, &Error{Code: "unknown_source", Msg: "unknown source; see status for providers"}
		}
		if !p.Cfgd() {
			return SearchResponse{}, &Error{Code: "provider_unconfigured", Msg: "provider '" + p.Name() + "' is missing credentials"}
		}
		targets = []providers.Provider{p}
	}
	if len(targets) == 0 {
		return SearchResponse{}, &Error{Code: "no_providers", Msg: "no metadata providers are configured"}
	}
	type part struct {
		name string
		res  core.SearchResult
		err  error
	}
	ch := make(chan part, len(targets))
	var wg sync.WaitGroup
	for _, p := range targets {
		wg.Add(1)
		go func(p providers.Provider) {
			defer wg.Done()
			res, err := p.Srch(ctx, q, kind, limit, offset)
			ch <- part{p.Name(), res, err}
		}(p)
	}
	wg.Wait()
	close(ch)
	resp := SearchResponse{SearchResult: core.SearchResult{Query: q}}
	for p := range ch {
		if p.err != nil {
			if resp.Errors == nil {
				resp.Errors = map[string]string{}
			}
			resp.Errors[p.name] = p.err.Error()
			continue
		}
		resp.Titles = append(resp.Titles, p.res.Titles...)
	}
	return resp, nil
}

func (e *Engine) get(source string) (providers.Provider, error) {
	p, ok := e.reg.Get(source)
	if !ok {
		return nil, &Error{Code: "unknown_source", Msg: "unknown source"}
	}
	if !p.Cfgd() {
		return nil, &Error{Code: "provider_unconfigured", Msg: "provider '" + p.Name() + "' is missing credentials"}
	}
	return p, nil
}

func (e *Engine) Meta(ctx context.Context, source, kind, id string) (core.Meta, error) {
	p, err := e.get(source)
	if err != nil {
		return core.Meta{}, err
	}
	m, err := p.Meta(ctx, kind, id)
	if err != nil {
		return core.Meta{}, &Error{Code: "upstream_error", Msg: err.Error()}
	}
	return m, nil
}

func (e *Engine) Stat() (map[string]any, error) {
	return map[string]any{"providers": e.reg.Stat()}, nil
}
