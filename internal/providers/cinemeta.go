package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"

	"movieapi/internal/core"
)

type Cinemeta struct {
	base string
	http *http.Client
}

func NewCinemeta(base string) *Cinemeta {
	return &Cinemeta{base: strings.TrimRight(base, "/"), http: client()}
}

func (c *Cinemeta) Name() string { return "cinemeta" }
func (c *Cinemeta) Cfgd() bool   { return c.base != "" }

type cmVideo struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Season   int    `json:"season"`
	Episode  int    `json:"episode"`
	Thumb    string `json:"thumbnail"`
	Released string `json:"released"`
}

type cmMeta struct {
	ID          string          `json:"id"`
	ImdbID      string          `json:"imdb_id"`
	Type        string          `json:"type"`
	Name        string          `json:"name"`
	Year        json.RawMessage `json:"year"`
	ReleaseInfo json.RawMessage `json:"releaseInfo"`
	Released    string          `json:"released"`
	Runtime     string          `json:"runtime"`
	ImdbRating  json.RawMessage `json:"imdbRating"`
	MoviedbID   int64           `json:"moviedb_id"`
	Genres      []string        `json:"genres"`
	Cast        []string        `json:"cast"`
	Director    json.RawMessage `json:"director"`
	Writer      json.RawMessage `json:"writer"`
	Country     string          `json:"country"`
	Awards      string          `json:"awards"`
	Poster      string          `json:"poster"`
	Background  string          `json:"background"`
	Logo        string          `json:"logo"`
	Description string          `json:"description"`
	Videos      []cmVideo       `json:"videos"`
	Trailers    []struct {
		Source string `json:"source"`
		Type   string `json:"type"`
	} `json:"trailers"`
	TrailerStreams []struct {
		Title string `json:"title"`
		YtID  string `json:"ytId"`
		Type  string `json:"type"`
	} `json:"trailerStreams"`
}

func str(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	var f json.Number
	if json.Unmarshal(raw, &f) == nil {
		return f.String()
	}
	return ""
}

func lst(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var l []string
	if json.Unmarshal(raw, &l) == nil {
		return l
	}
	var s string
	if json.Unmarshal(raw, &s) == nil && s != "" {
		return []string{s}
	}
	return nil
}

func fst(v ...string) string {
	for _, s := range v {
		if s != "" {
			return s
		}
	}
	return ""
}

func (m *cmMeta) title() core.Title {
	yr := str(m.Year)
	if yr == "" {
		yr = str(m.ReleaseInfo)
	}
	return core.Title{
		ID:          fst(m.ID, m.ImdbID),
		Source:      "cinemeta",
		Type:        fst(m.Type, "movie"),
		Name:        m.Name,
		Year:        yr,
		Poster:      m.Poster,
		ImdbRating:  str(m.ImdbRating),
		Description: m.Description,
	}
}

func (m *cmMeta) meta() core.Meta {
	t := m.title()
	out := core.Meta{
		ID:          t.ID,
		Source:      t.Source,
		Type:        t.Type,
		Name:        t.Name,
		TMDB:        m.MoviedbID,
		Year:        t.Year,
		Released:    m.Released,
		Runtime:     m.Runtime,
		ImdbRating:  t.ImdbRating,
		Genres:      m.Genres,
		Cast:        m.Cast,
		Directors:   lst(m.Director),
		Writers:     lst(m.Writer),
		Description: m.Description,
		Country:     m.Country,
		Awards:      m.Awards,
		Poster:      m.Poster,
		Background:  m.Background,
		Logo:        m.Logo,
	}
	for _, v := range m.Videos {
		out.Videos = append(out.Videos, core.Video{
			ID: v.ID, Title: v.Title, Type: "episode",
			Season: v.Season, Episode: v.Episode, Thumb: v.Thumb, Released: v.Released,
		})
	}
	for _, tr := range m.TrailerStreams {
		out.Trailers = append(out.Trailers, core.Video{
			ID: tr.YtID, Title: tr.Title, Type: "trailer",
			URL: "https://www.youtube.com/watch?v=" + tr.YtID,
		})
	}
	for _, tr := range m.Trailers {
		out.Trailers = append(out.Trailers, core.Video{
			ID: tr.Source, Type: fst(tr.Type, "trailer"),
			URL: "https://www.youtube.com/watch?v=" + tr.Source,
		})
	}
	return out
}

func (c *Cinemeta) get(ctx context.Context, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", "movieapi/0.1")
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("cinemeta: %s %s", resp.Status, path)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Cinemeta) st(ctx context.Context, q, kind string) ([]cmMeta, error) {
	var out struct {
		Metas []cmMeta `json:"metas"`
	}
	err := c.get(ctx, fmt.Sprintf("/catalog/%s/top/search=%s.json",
		url.PathEscape(kind), url.PathEscape(q)), &out)
	return out.Metas, err
}

func (c *Cinemeta) Srch(ctx context.Context, q, kind string, limit, offset int) (core.SearchResult, error) {
	res := core.SearchResult{Query: q}
	kinds := []string{"movie", "series"}
	if kind == "movie" || kind == "series" {
		kinds = []string{kind}
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	var ferr error
	for _, k := range kinds {
		wg.Add(1)
		go func(k string) {
			defer wg.Done()
			metas, err := c.st(ctx, q, k)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				if ferr == nil {
					ferr = err
				}
				return
			}
			for i := range metas {
				res.Titles = append(res.Titles, metas[i].title())
			}
		}(k)
	}
	wg.Wait()
	if len(res.Titles) == 0 && ferr != nil {
		return res, ferr
	}
	if offset < len(res.Titles) {
		res.Titles = res.Titles[offset:]
	} else {
		res.Titles = nil
	}
	if len(res.Titles) > limit {
		res.Titles = res.Titles[:limit]
	}
	return res, nil
}

func (c *Cinemeta) Meta(ctx context.Context, kind, id string) (core.Meta, error) {
	if kind != "movie" && kind != "series" {
		kind = "movie"
	}
	var out struct {
		Meta cmMeta `json:"meta"`
	}
	if err := c.get(ctx, fmt.Sprintf("/meta/%s/%s.json",
		url.PathEscape(kind), url.PathEscape(id)), &out); err != nil {
		return core.Meta{}, err
	}
	if out.Meta.ID == "" && out.Meta.ImdbID == "" {
		return core.Meta{}, fmt.Errorf("cinemeta: %s %s not found", kind, id)
	}
	return out.Meta.meta(), nil
}
