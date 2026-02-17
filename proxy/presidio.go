package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const presidioBaseURL = "http://127.0.0.1:9401"

// PresidioClient communicates with the Presidio engine over HTTP.
type PresidioClient struct {
	client *http.Client
}

type PresidioAnalyzeRequest struct {
	Text           string  `json:"text"`
	Language       string  `json:"language"`
	ScoreThreshold float64 `json:"score_threshold"`
}

type Entity struct {
	EntityType   string  `json:"entity_type"`
	Start        int     `json:"start"`
	End          int     `json:"end"`
	Score        float64 `json:"score"`
	OriginalText string  `json:"original_text,omitempty"`
	NewValue     string  `json:"new_value,omitempty"`
}

type PresidioAnonymizeResponse struct {
	Text     string   `json:"text"`
	Entities []Entity `json:"entities"`
	Count    int      `json:"count"`
}

func NewPresidioClient() *PresidioClient {
	return &PresidioClient{
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *PresidioClient) Anonymize(text string) (*PresidioAnonymizeResponse, error) {
	reqBody := PresidioAnalyzeRequest{
		Text:           text,
		Language:       "en",
		ScoreThreshold: 0.3,
	}
	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := p.client.Post(presidioBaseURL+"/anonymize", "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("presidio request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("presidio returned %d: %s", resp.StatusCode, string(body))
	}

	var result PresidioAnonymizeResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return &result, nil
}

func (p *PresidioClient) Analyze(text string) ([]Entity, error) {
	reqBody := PresidioAnalyzeRequest{
		Text:           text,
		Language:       "en",
		ScoreThreshold: 0.3,
	}
	data, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}

	resp, err := p.client.Post(presidioBaseURL+"/analyze", "application/json", bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("presidio request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("presidio returned %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Entities []Entity `json:"entities"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	return result.Entities, nil
}

func (p *PresidioClient) Health() error {
	resp, err := p.client.Get(presidioBaseURL + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("presidio health returned %d", resp.StatusCode)
	}
	return nil
}
