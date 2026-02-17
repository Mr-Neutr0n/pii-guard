package main

import "sync"

// Config manages which PII entity types are active for detection.
type Config struct {
	mu       sync.RWMutex
	Entities map[string]bool `json:"entities"`
}

var defaultEntities = map[string]bool{
	"PERSON":        true,
	"EMAIL_ADDRESS": true,
	"PHONE_NUMBER":  true,
	"IN_AADHAAR":    true,
	"IN_PAN":        true,
	"CREDIT_CARD":   true,
	"LOCATION":      true,
	"IP_ADDRESS":    true,
	"IN_UPI_ID":     true,
	"DATE_TIME":     true,
	"US_SSN":        true,
	"IN_PASSPORT":   true,
}

func NewConfig() *Config {
	entities := make(map[string]bool, len(defaultEntities))
	for k, v := range defaultEntities {
		entities[k] = v
	}
	return &Config{Entities: entities}
}

func (c *Config) GetEntities() map[string]bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	cp := make(map[string]bool, len(c.Entities))
	for k, v := range c.Entities {
		cp[k] = v
	}
	return cp
}

func (c *Config) SetEntity(entity string, enabled bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Entities[entity] = enabled
}

func (c *Config) EnabledEntities() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var result []string
	for k, v := range c.Entities {
		if v {
			result = append(result, k)
		}
	}
	return result
}
