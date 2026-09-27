import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Toolbar, type ToolbarProps } from './Toolbar';

const baseProps = (): ToolbarProps => ({
  modality: 'CT',
  tool: 'crosshairs',
  onTool: vi.fn(),
  voiPresetName: '',
  onVoiPreset: vi.fn(),
  volPresetName: 'CT-Bone',
  onVolumePreset: vi.fn(),
  onInvert: vi.fn(),
  onReset: vi.fn(),
  dirty: false,
  saving: false,
  canMeasure: true,
  onSave: vi.fn(),
  reportUrl: null,
});

test('CT toolbar exposes presets and fires callbacks', async () => {
  const p = baseProps();
  render(<Toolbar {...p} />);

  await userEvent.selectOptions(screen.getByLabelText('MPR window'), 'Bone');
  expect(p.onVoiPreset).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Bone', center: 400, width: 1800 }),
  );
  await userEvent.selectOptions(screen.getByLabelText('3D preset'), 'CT-Soft-Tissue');
  expect(p.onVolumePreset).toHaveBeenCalledWith('CT-Soft-Tissue');
  await userEvent.click(screen.getByRole('button', { name: /length/i }));
  expect(p.onTool).toHaveBeenCalledWith('Length');
  await userEvent.click(screen.getByRole('button', { name: /bidirectional/i }));
  expect(p.onTool).toHaveBeenCalledWith('Bidirectional');
  await userEvent.click(screen.getByRole('button', { name: /invert/i }));
  expect(p.onInvert).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /reset/i }));
  expect(p.onReset).toHaveBeenCalled();
});

test('MR toolbar disables the MPR window select when there are no VOI presets', () => {
  render(<Toolbar {...baseProps()} modality="MR" volPresetName="MR-Default" />);

  const voiSelect = screen.getByLabelText('MPR window');
  expect(voiSelect).toBeDisabled();
  expect(screen.getByText('from header')).toBeInTheDocument();

  // 3D presets are still populated for MR (MR-Default, MR-T2-Brain).
  expect(screen.getByLabelText('3D preset')).not.toBeDisabled();
});

test('measurement modes are disabled when the series cannot be measured', () => {
  render(<Toolbar {...baseProps()} canMeasure={false} />);
  expect(screen.getByRole('button', { name: /length/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /ellipse/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /bidirectional/i })).toBeDisabled();
  // Navigation is never blocked: the images are still readable.
  expect(screen.getByRole('button', { name: /crosshairs/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /^window$/i })).toBeEnabled();
});

test('save is disabled until something changes, and reports when saving', () => {
  const { rerender } = render(<Toolbar {...baseProps()} />);
  expect(screen.getByRole('button', { name: /^saved$/i })).toBeDisabled();

  rerender(<Toolbar {...baseProps()} dirty />);
  expect(screen.getByRole('button', { name: /save measurements/i })).toBeEnabled();

  rerender(<Toolbar {...baseProps()} dirty saving />);
  expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled();
});

test('the report link appears only once a report exists', () => {
  const { rerender } = render(<Toolbar {...baseProps()} />);
  expect(screen.queryByRole('link', { name: /download report/i })).toBeNull();

  rerender(<Toolbar {...baseProps()} reportUrl="http://localhost:8001/report.dcm" />);
  expect(screen.getByRole('link', { name: /download report/i })).toHaveAttribute(
    'href',
    'http://localhost:8001/report.dcm',
  );
});
