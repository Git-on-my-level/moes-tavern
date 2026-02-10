import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TaskPage from '../../app/task/[id]/page';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual('next/navigation');
  return {
    ...actual,
    useParams: () => ({ id: '1' }),
  };
});

vi.mock('../../src/lib/api-client', () => ({
  mockApiClient: {
    getTask: vi.fn((taskId: number) => {
      const tasks: any[] = [
        {
          taskId: 1,
          listingId: 1,
          agentId: 1,
          buyer: '0xbuyer1',
          status: 'OPEN',
          taskURI: 'ipfs://task1',
          proposedUnits: 50,
          postedAt: Date.now() - 100000,
        },
        {
          taskId: 2,
          listingId: 1,
          agentId: 1,
          buyer: '0xbuyer2',
          status: 'QUOTED',
          taskURI: 'ipfs://task2',
          proposedUnits: 30,
          quotedUnits: 30,
          quotedTotalPrice: 400,
          quoteExpiry: Date.now() + 3600000,
          postedAt: Date.now() - 200000,
        },
        {
          taskId: 3,
          listingId: 1,
          agentId: 1,
          buyer: '0xbuyer3',
          status: 'ACTIVE',
          taskURI: 'ipfs://task3',
          proposedUnits: 20,
          quotedUnits: 20,
          quotedTotalPrice: 300,
          fundedAmount: 300,
          postedAt: Date.now() - 300000,
          acceptedAt: Date.now() - 100000,
        },
        {
          taskId: 4,
          listingId: 1,
          agentId: 1,
          buyer: '0xbuyer4',
          status: 'SUBMITTED',
          taskURI: 'ipfs://task4',
          proposedUnits: 25,
          quotedUnits: 25,
          quotedTotalPrice: 350,
          fundedAmount: 350,
          artifactURI: 'ipfs://artifact4',
          artifactHash: '0xabc123',
          postedAt: Date.now() - 500000,
          acceptedAt: Date.now() - 400000,
          submittedAt: Date.now() - 100000,
        },
      ];
      return Promise.resolve(tasks.find((t) => t.taskId === taskId) ?? null);
    }),
  },
}));

describe('TaskPage', () => {
  it('should render OPEN task state', async () => {
    render(<TaskPage params={{ id: '1' }} />);

    expect(await screen.findByText(/Task #1/i)).toBeDefined();
    expect(screen.getAllByText(/OPEN/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Quoted Units:/i)).toBeNull();
  });

  it('should render QUOTED task state with countdown', async () => {
    render(<TaskPage params={{ id: '2' }} />);

    expect(await screen.findByText(/Task #2/i)).toBeDefined();
    expect(screen.getAllByText(/QUOTED/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Quoted Units:/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Quote Expires In:/i)).toBeDefined();
  });

  it('should render ACTIVE task state with deliverable submission fields', async () => {
    render(<TaskPage params={{ id: '3' }} />);

    expect(await screen.findByText(/Task #3/i)).toBeDefined();
    expect(screen.getAllByText(/ACTIVE/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Deliverable Submission/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/ipfs:\/\/\.\.\./i)).toBeDefined();
    expect(screen.getByPlaceholderText(/0x\.\.\./i)).toBeDefined();
  });

  it('should render SUBMITTED task state with read-only deliverable fields', async () => {
    render(<TaskPage params={{ id: '4' }} />);

    expect(await screen.findByText(/Task #4/i)).toBeDefined();
    expect(screen.getAllByText(/SUBMITTED/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Deliverable Submission/i)).toBeDefined();

    const allInputs = screen.getAllByPlaceholderText(/ipfs:\/\/\.\.\./i);
    const disabledInputs = allInputs.filter((input) => {
      return input.getAttribute('disabled') !== null;
    });
    expect(disabledInputs.length).toBeGreaterThan(0);
  });
});
