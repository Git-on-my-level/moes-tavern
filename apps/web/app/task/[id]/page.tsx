'use client';

import { useState, useEffect } from 'react';
import { mockApiClient } from '../../../src/lib/api-client';
import type { Task } from '../../../src/lib/models';
import Link from 'next/link';

export default function TaskPage({ params }: { params: { id: string } }) {
  const [task, setTask] = useState<Task | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    mockApiClient.getTask(parseInt(params.id, 10)).then((result) => {
      setTask(result);
      setIsLoading(false);
    });
  }, [params.id]);

  if (isLoading) {
    return <div style={{ padding: '2rem' }}>Loading...</div>;
  }

  if (!task) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>Task not found</p>
        <Link href="/">Back to search</Link>
      </div>
    );
  }

  const statusColors: Record<Task['status'], string> = {
    OPEN: '#ffc107',
    QUOTED: '#17a2b8',
    ACTIVE: '#28a745',
    SUBMITTED: '#007bff',
    DISPUTED: '#dc3545',
    SETTLED: '#6c757d',
    CANCELLED: '#6c757d',
  };

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

      <div
        style={{
          display: 'inline-block',
          padding: '0.25rem 0.5rem',
          backgroundColor: statusColors[task.status],
          color: 'white',
          borderRadius: '4px',
          marginBottom: '1rem',
        }}
      >
        {task.status}
      </div>

      <h1 style={{ marginBottom: '2rem' }}>Task #{task.taskId}</h1>

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Quote State
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.5rem',
          }}
        >
          <dt style={{ fontWeight: 'bold' }}>Status:</dt>
          <dd>{task.status}</dd>

          {task.quotedUnits !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Quoted Units:</dt>
              <dd>{task.quotedUnits}</dd>
            </>
          )}

          {task.quotedTotalPrice !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Quoted Price:</dt>
              <dd>{task.quotedTotalPrice}</dd>
            </>
          )}

          {task.quoteExpiry !== undefined && task.status === 'QUOTED' && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Quote Expires In:</dt>
              <dd>
                {Math.max(
                  0,
                  Math.ceil(
                    ((task.quoteExpiry < 10 ** 12
                      ? task.quoteExpiry * 1000
                      : task.quoteExpiry) -
                      Date.now()) /
                      1000,
                  ),
                )}
                s
              </dd>
            </>
          )}
        </div>
      </section>

      {task.status === 'ACTIVE' || task.status === 'SUBMITTED' ? (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            Deliverable Submission
          </h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '0.5rem',
            }}
          >
            <dt style={{ fontWeight: 'bold' }}>Artifact URI:</dt>
            <dd>
              <input
                type="text"
                placeholder="ipfs://..."
                disabled={task.status === 'SUBMITTED'}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                }}
              />
            </dd>
            <dt style={{ fontWeight: 'bold' }}>Artifact Hash:</dt>
            <dd>
              <input
                type="text"
                placeholder="0x..."
                disabled={task.status === 'SUBMITTED'}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                }}
              />
            </dd>
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Task Details
        </h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.5rem',
          }}
        >
          <dt style={{ fontWeight: 'bold' }}>Task ID:</dt>
          <dd>{task.taskId}</dd>

          <dt style={{ fontWeight: 'bold' }}>Listing ID:</dt>
          <dd>{task.listingId}</dd>

          <dt style={{ fontWeight: 'bold' }}>Agent ID:</dt>
          <dd>{task.agentId}</dd>

          <dt style={{ fontWeight: 'bold' }}>Buyer:</dt>
          <dd style={{ fontFamily: 'monospace' }}>{task.buyer}</dd>

          <dt style={{ fontWeight: 'bold' }}>Proposed Units:</dt>
          <dd>{task.proposedUnits}</dd>

          {task.quotedUnits !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Quoted Units:</dt>
              <dd>{task.quotedUnits}</dd>
            </>
          )}

          {task.quotedTotalPrice !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Quoted Price:</dt>
              <dd>{task.quotedTotalPrice}</dd>
            </>
          )}

          {task.fundedAmount !== undefined && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Funded Amount:</dt>
              <dd>{task.fundedAmount}</dd>
            </>
          )}

          {task.taskURI && (
            <>
              <dt style={{ fontWeight: 'bold' }}>Task URI:</dt>
              <dd>
                <a
                  href={task.taskURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#007bff' }}
                >
                  {task.taskURI}
                </a>
              </dd>
            </>
          )}
        </dl>
      </section>

      {task.artifactURI && (
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
            Deliverable
          </h2>
          <p>
            <strong>Artifact URI:</strong>{' '}
            <a
              href={task.artifactURI}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#007bff' }}
            >
              {task.artifactURI}
            </a>
          </p>
          {task.artifactHash && (
            <p style={{ marginTop: '0.5rem' }}>
              <strong>Hash:</strong>{' '}
              <span style={{ fontFamily: 'monospace' }}>
                {task.artifactHash}
              </span>
            </p>
          )}
        </section>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          Timeline
        </h2>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
        >
          {task.postedAt && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontWeight: 'bold' }}>Posted:</span>
              <span>{new Date(task.postedAt).toLocaleString()}</span>
            </div>
          )}
          {task.acceptedAt && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontWeight: 'bold' }}>Accepted:</span>
              <span>{new Date(task.acceptedAt).toLocaleString()}</span>
            </div>
          )}
          {task.submittedAt && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontWeight: 'bold' }}>Submitted:</span>
              <span>{new Date(task.submittedAt).toLocaleString()}</span>
            </div>
          )}
          {task.settledAt && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <span style={{ fontWeight: 'bold' }}>Settled:</span>
              <span>{new Date(task.settledAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
