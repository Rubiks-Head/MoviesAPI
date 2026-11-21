package core

type Title struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	Year        string `json:"year,omitempty"`
	Poster      string `json:"poster,omitempty"`
	ImdbRating  string `json:"imdb_rating,omitempty"`
	Description string `json:"description,omitempty"`
}

type Video struct {
	ID       string `json:"id"`
	Title    string `json:"title,omitempty"`
	Type     string `json:"type,omitempty"`
	Season   int    `json:"season,omitempty"`
	Episode  int    `json:"episode,omitempty"`
	Thumb    string `json:"thumbnail,omitempty"`
	Released string `json:"released,omitempty"`
	URL      string `json:"url,omitempty"`
}

type Meta struct {
	ID          string   `json:"id"`
	Source      string   `json:"source"`
	Type        string   `json:"type"`
	Name        string   `json:"name"`
	TMDB        int64    `json:"tmdb_id,omitempty"`
	Year        string   `json:"year,omitempty"`
	Released    string   `json:"released,omitempty"`
	Runtime     string   `json:"runtime,omitempty"`
	ImdbRating  string   `json:"imdb_rating,omitempty"`
	Genres      []string `json:"genres,omitempty"`
	Cast        []string `json:"cast,omitempty"`
	Directors   []string `json:"directors,omitempty"`
	Writers     []string `json:"writers,omitempty"`
	Description string   `json:"description,omitempty"`
	Country     string   `json:"country,omitempty"`
	Awards      string   `json:"awards,omitempty"`
	Poster      string   `json:"poster,omitempty"`
	Background  string   `json:"background,omitempty"`
	Logo        string   `json:"logo,omitempty"`
	Trailers    []Video  `json:"trailers,omitempty"`
	Videos      []Video  `json:"videos,omitempty"`
}

type SearchResult struct {
	Query  string  `json:"query"`
	Titles []Title `json:"titles"`
}
