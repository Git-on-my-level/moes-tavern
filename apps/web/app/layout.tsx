import {
  SearchProvider,
  ListingProvider,
  TaskDraftProvider,
} from '../src/lib/context';
import type { ReactNode } from 'react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SearchProvider>
          <ListingProvider>
            <TaskDraftProvider>{children}</TaskDraftProvider>
          </ListingProvider>
        </SearchProvider>
      </body>
    </html>
  );
}
