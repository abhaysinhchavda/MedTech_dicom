import { render, screen } from '@testing-library/react';
import { MetadataPanel } from './MetadataPanel';
import { volumeInfoJson } from '../../test/msw';
import type { VolumeInfo } from '../../api/types';

test('shows dims, spacing, modality and memory', () => {
  render(<MetadataPanel info={volumeInfoJson as VolumeInfo} description="Synthetic series" />);
  expect(screen.getByText('16 × 16 × 4')).toBeInTheDocument();
  expect(screen.getByText('0.50 × 0.50 × 1.00 mm')).toBeInTheDocument();
  expect(screen.getByText('CT')).toBeInTheDocument();
  expect(screen.getByText('2.0 KB')).toBeInTheDocument();
});
