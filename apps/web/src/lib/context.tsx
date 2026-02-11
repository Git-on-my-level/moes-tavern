'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import type {
  SearchQuery,
  SearchResult,
  SearchFacets,
  SearchListing,
  TaskDraft,
} from './models';

type SearchState = {
  query: SearchQuery;
  results: SearchResult[];
  facets: SearchFacets;
  isLoading: boolean;
  setQuery: (query: SearchQuery) => void;
  setResults: (results: SearchResult[], facets: SearchFacets) => void;
  setLoading: (loading: boolean) => void;
};

const SearchContext = createContext<SearchState | null>(null);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState<SearchQuery>({});
  const [results, setResultsState] = useState<SearchResult[]>([]);
  const [facets, setFacets] = useState<SearchFacets>({
    unitType: {},
    priceBucket: {},
  });
  const [isLoading, setLoading] = useState(false);

  const setResults = useCallback(
    (newResults: SearchResult[], newFacets: SearchFacets) => {
      setResultsState(newResults);
      setFacets(newFacets);
    },
    [],
  );

  return (
    <SearchContext.Provider
      value={{
        query,
        results,
        facets,
        isLoading,
        setQuery,
        setResults,
        setLoading,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}

type ListingState = {
  selectedListing: SearchListing | null;
  setSelectedListing: (listing: SearchListing | null) => void;
};

const ListingContext = createContext<ListingState | null>(null);

export function ListingProvider({ children }: { children: ReactNode }) {
  const [selectedListing, setSelectedListing] = useState<SearchListing | null>(
    null,
  );

  return (
    <ListingContext.Provider value={{ selectedListing, setSelectedListing }}>
      {children}
    </ListingContext.Provider>
  );
}

export function useListing() {
  const context = useContext(ListingContext);
  if (!context) {
    throw new Error('useListing must be used within a ListingProvider');
  }
  return context;
}

type TaskDraftState = {
  draft: TaskDraft | null;
  setDraft: (draft: TaskDraft | null) => void;
  updateDraft: (updates: Partial<TaskDraft>) => void;
};

const TaskDraftContext = createContext<TaskDraftState | null>(null);

export function TaskDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraftState] = useState<TaskDraft | null>(null);

  const setDraft = useCallback((newDraft: TaskDraft | null) => {
    setDraftState(newDraft);
  }, []);

  const updateDraft = useCallback((updates: Partial<TaskDraft>) => {
    setDraftState((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  return (
    <TaskDraftContext.Provider value={{ draft, setDraft, updateDraft }}>
      {children}
    </TaskDraftContext.Provider>
  );
}

export function useTaskDraft() {
  const context = useContext(TaskDraftContext);
  if (!context) {
    throw new Error('useTaskDraft must be used within a TaskDraftProvider');
  }
  return context;
}
