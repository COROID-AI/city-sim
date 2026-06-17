import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CitySimPage from '@/app/page';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <CitySimPage />
  </StrictMode>,
);
