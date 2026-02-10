'use client';

import { useState, useEffect } from 'react';
import { mockApiClient } from '../../../src/lib/api-client';
import type { SearchListing } from '../../../src/lib/models';
import Link from 'next/link';

export default function ListingPage({ params }: { params: { id: string } }) {
  const [listing, setListing] = useState<SearchListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    mockApiClient.getListing(parseInt(params.id, 10)).then((result) => {
      setListing(result);
      setIsLoading(false);
    });
  }, [params.id]);

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  if (!listing) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Listing not found</p>
        <Link href="/">Back to search</Link>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Link
        href="/"
        style={{
          display: 'inline-block',
          marginBottom: '1rem',
          color: '#007bff',
        }}
      >
        ← Back to search
      </Link>

      <h1 style={{ marginBottom: '1rem' }}>{listing.metadata.title}</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Description
        </h2>
        <p>{listing.metadata.description}</p>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Pricing</h2>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div>
            <strong>Unit Price:</strong> {listing.pricing.unitPrice}{' '}
            {listing.pricing.unitType}
          </div>
          <div>
            <strong>Base Price:</strong> {listing.pricing.basePrice}
          </div>
          <div>
            <strong>Min Units:</strong> {listing.pricing.minUnits}
          </div>
          <div>
            <strong>Max Units:</strong> {listing.pricing.maxUnits}
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>Tags</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {listing.metadata.tags.map((tag: string) => (
            <span
              key={tag}
              style={{
                padding: '0.25rem 0.5rem',
                backgroundColor: '#e9ecef',
                borderRadius: '4px',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </section>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Agent Metrics
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '0.5rem',
          }}
        >
          <div>
            <strong>Accept Rate:</strong>{' '}
            {(listing.metrics.acceptRate * 100).toFixed(1)}%
          </div>
          <div>
            <strong>Dispute Rate:</strong>{' '}
            {(listing.metrics.disputeRate * 100).toFixed(1)}%
          </div>
          <div>
            <strong>Cancel Rate:</strong>{' '}
            {(listing.metrics.cancelRate * 100).toFixed(1)}%
          </div>
          <div>
            <strong>Completed Tasks:</strong> {listing.metrics.settledCount}
          </div>
          <div>
            <strong>Avg Time to Submit:</strong>{' '}
            {Math.round(listing.metrics.avgTimeToSubmitSec / 60)} minutes
          </div>
        </div>
      </section>

      {listing.curation && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            Curation Badges
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {listing.curation.badges.metadata_validated && (
              <span
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  borderRadius: '4px',
                }}
              >
                ✓ Metadata Validated
              </span>
            )}
            {listing.curation.badges.endpoint_verified && (
              <span
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  borderRadius: '4px',
                }}
              >
                ✓ Endpoint Verified
              </span>
            )}
            {listing.curation.badges.probe_passed && (
              <span
                style={{
                  padding: '0.25rem 0.5rem',
                  backgroundColor: '#d4edda',
                  color: '#155724',
                  borderRadius: '4px',
                }}
              >
                ✓ Probe Passed
              </span>
            )}
          </div>
        </section>
      )}

      <section>
        <Link
          href={`/task/new?listingId=${listing.listingId}`}
          style={{
            display: 'inline-block',
            padding: '0.75rem 1.5rem',
            backgroundColor: '#007bff',
            color: 'white',
            textDecoration: 'none',
            borderRadius: '4px',
          }}
        >
          Create Task
        </Link>
      </section>
    </div>
  );
}
