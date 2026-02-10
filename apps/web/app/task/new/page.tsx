'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { mockApiClient } from '../../../src/lib/api-client';
import type { SearchListing, TaskDraft } from '../../../src/lib/models';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

function NewTaskPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const listingId = searchParams.get('listingId');

  const [listing, setListing] = useState<SearchListing | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [draft, setDraft] = useState<TaskDraft>({
    listingId: listingId ? parseInt(listingId, 10) : 0,
    proposedUnits: 1,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (listingId) {
      mockApiClient.getListing(parseInt(listingId, 10)).then((result) => {
        setListing(result);
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, [listingId]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!draft.listingId) {
      newErrors.listingId = 'Listing is required';
    }
    if (draft.proposedUnits < 1) {
      newErrors.proposedUnits = 'Must be at least 1';
    }
    if (draft.taskURI && !isValidUrl(draft.taskURI)) {
      newErrors.taskURI = 'Must be a valid URL';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);
    try {
      const task = await mockApiClient.createTask(draft);
      router.push(`/task/${task.taskId}`);
    } catch (err) {
      setErrors({
        submit: err instanceof Error ? err.message : 'Failed to create task',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
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

      <h1 style={{ marginBottom: '1rem' }}>Create New Task</h1>

      {listing && (
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: '4px',
            padding: '1rem',
            marginBottom: '2rem',
            backgroundColor: '#f8f9fa',
          }}
        >
          <h3 style={{ marginBottom: '0.5rem' }}>{listing.metadata.title}</h3>
          <p style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
            {listing.metadata.description}
          </p>
          <p style={{ fontSize: '0.875rem' }}>
            <strong>Price:</strong> {listing.pricing.unitPrice}{' '}
            {listing.pricing.unitType} per unit
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="listingId"
            style={{
              display: 'block',
              marginBottom: '0.25rem',
              fontWeight: 'bold',
            }}
          >
            Listing ID
          </label>
          <input
            type="number"
            id="listingId"
            value={draft.listingId}
            onChange={(e) =>
              setDraft({ ...draft, listingId: parseInt(e.target.value, 10) })
            }
            disabled={!!listing}
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              backgroundColor: listing ? '#e9ecef' : 'white',
            }}
          />
          {errors.listingId && (
            <p
              style={{
                color: '#dc3545',
                fontSize: '0.875rem',
                marginTop: '0.25rem',
              }}
            >
              {errors.listingId}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="proposedUnits"
            style={{
              display: 'block',
              marginBottom: '0.25rem',
              fontWeight: 'bold',
            }}
          >
            Proposed Units
          </label>
          <input
            type="number"
            id="proposedUnits"
            min="1"
            value={draft.proposedUnits}
            onChange={(e) =>
              setDraft({
                ...draft,
                proposedUnits: parseInt(e.target.value, 10),
              })
            }
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          {errors.proposedUnits && (
            <p
              style={{
                color: '#dc3545',
                fontSize: '0.875rem',
                marginTop: '0.25rem',
              }}
            >
              {errors.proposedUnits}
            </p>
          )}
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label
            htmlFor="taskURI"
            style={{
              display: 'block',
              marginBottom: '0.25rem',
              fontWeight: 'bold',
            }}
          >
            Task URI (optional)
          </label>
          <input
            type="text"
            id="taskURI"
            placeholder="https://ipfs.io/..."
            value={draft.taskURI ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, taskURI: e.target.value || undefined })
            }
            style={{
              width: '100%',
              padding: '0.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
            }}
          />
          {errors.taskURI && (
            <p
              style={{
                color: '#dc3545',
                fontSize: '0.875rem',
                marginTop: '0.25rem',
              }}
            >
              {errors.taskURI}
            </p>
          )}
        </div>

        {errors.submit && (
          <p style={{ color: '#dc3545', marginBottom: '1rem' }}>
            {errors.submit}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            disabled={isSubmitting}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </button>
          <Link
            href="/"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#6c757d',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
            }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewTaskPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem' }}>Loading...</div>}>
      <NewTaskPageContent />
    </Suspense>
  );
}
