'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearch } from '../src/lib/context';
import { mockApiClient } from '../src/lib/api-client';
import Link from 'next/link';

export default function SearchPage() {
  const {
    query,
    results,
    facets,
    isLoading,
    setQuery,
    setResults,
    setLoading,
  } = useSearch();
  const [searchText, setSearchText] = useState('');

  const handleSearch = useCallback(async () => {
    setLoading(true);
    try {
      const response = await mockApiClient.search({
        ...query,
        text: searchText,
      });
      setResults(response.results, response.facets);
    } finally {
      setLoading(false);
    }
  }, [query, searchText, setLoading, setResults]);

  useEffect(() => {
    handleSearch();
  }, [handleSearch]);

  const handleFilterChange = (
    filterType: 'unitType' | 'priceBucket',
    value: string | undefined,
  ) => {
    const newQuery = { ...query, [filterType]: value };
    setQuery(newQuery);
    setLoading(true);
    mockApiClient.search({ ...newQuery, text: searchText }).then((response) => {
      setResults(response.results, response.facets);
      setLoading(false);
    });
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>
          Moe&apos;s Tavern - Agent Marketplace
        </h1>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input
            type="text"
            placeholder="Search agents..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            style={{
              flex: 1,
              padding: '0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          <button
            onClick={handleSearch}
            disabled={isLoading}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: '2rem' }}>
        <aside style={{ width: '250px', flexShrink: 0 }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Filters</h3>

          <div style={{ marginBottom: '1rem' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontWeight: 'bold',
              }}
            >
              Unit Type
            </label>
            <select
              value={query.unitType ?? ''}
              onChange={(e) =>
                handleFilterChange('unitType', e.target.value || undefined)
              }
              style={{ width: '100%', padding: '0.25rem' }}
            >
              <option value="">All</option>
              {Object.entries(facets.unitType).map(([type, count]) => (
                <option key={type} value={type}>
                  {type} ({count})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '0.25rem',
                fontWeight: 'bold',
              }}
            >
              Price Range
            </label>
            <select
              value={query.priceBucket ?? ''}
              onChange={(e) =>
                handleFilterChange('priceBucket', e.target.value || undefined)
              }
              style={{ width: '100%', padding: '0.25rem' }}
            >
              <option value="">All</option>
              {Object.entries(facets.priceBucket).map(([bucket, count]) => (
                <option key={bucket} value={bucket}>
                  {bucket} ({count})
                </option>
              ))}
            </select>
          </div>
        </aside>

        <main style={{ flex: 1 }}>
          <p style={{ marginBottom: '1rem' }}>
            {results.length} result{results.length !== 1 ? 's' : ''} found
          </p>

          {results.map((result) => (
            <div
              key={result.listingId}
              style={{
                border: '1px solid #ddd',
                borderRadius: '4px',
                padding: '1rem',
                marginBottom: '1rem',
              }}
            >
              <Link href={`/listing/${result.listingId}`}>
                <h3 style={{ color: '#007bff', marginBottom: '0.5rem' }}>
                  {result.listing.metadata.title}
                </h3>
              </Link>
              <p style={{ marginBottom: '0.5rem' }}>
                {result.listing.metadata.description}
              </p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                {result.listing.metadata.tags.map((tag: string) => (
                  <span
                    key={tag}
                    style={{
                      padding: '0.25rem 0.5rem',
                      backgroundColor: '#e9ecef',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div
                style={{
                  marginTop: '0.5rem',
                  fontSize: '0.875rem',
                  color: '#666',
                }}
              >
                <span>
                  {result.listing.pricing.unitPrice}{' '}
                  {result.listing.pricing.unitType}
                </span>
                <span style={{ margin: '0 0.5rem' }}>•</span>
                <span>Trust: {(result.trustScore * 100).toFixed(0)}%</span>
              </div>
            </div>
          ))}

          {results.length === 0 && !isLoading && (
            <p style={{ color: '#666', fontStyle: 'italic' }}>
              No results found
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
