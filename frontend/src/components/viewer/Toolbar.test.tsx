import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Toolbar } from './Toolbar';

test('CT toolbar exposes presets and fires callbacks', async () => {
  const onVoi = vi.fn();
  const onVol = vi.fn();
  const onX = vi.fn();
  const onReset = vi.fn();
  const onInvert = vi.fn();
  render(
    <Toolbar
      modality="CT"
      crosshairs
      onCrosshairs={onX}
      voiPresetName=""
      onVoiPreset={onVoi}
      volPresetName="CT-Bone"
      onVolumePreset={onVol}
      onInvert={onInvert}
      onReset={onReset}
    />,
  );
  await userEvent.selectOptions(screen.getByLabelText('MPR window'), 'Bone');
  expect(onVoi).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'Bone', center: 400, width: 1800 }),
  );
  await userEvent.selectOptions(screen.getByLabelText('3D preset'), 'CT-Soft-Tissue');
  expect(onVol).toHaveBeenCalledWith('CT-Soft-Tissue');
  await userEvent.click(screen.getByRole('button', { name: /crosshairs/i }));
  expect(onX).toHaveBeenCalledWith(false);
  await userEvent.click(screen.getByRole('button', { name: /invert/i }));
  expect(onInvert).toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /reset/i }));
  expect(onReset).toHaveBeenCalled();
});

test('MR toolbar disables the MPR window select when there are no VOI presets', () => {
  const onVoi = vi.fn();
  const onVol = vi.fn();
  const onX = vi.fn();
  const onReset = vi.fn();
  const onInvert = vi.fn();
  render(
    <Toolbar
      modality="MR"
      crosshairs={false}
      onCrosshairs={onX}
      voiPresetName=""
      onVoiPreset={onVoi}
      volPresetName="MR-Default"
      onVolumePreset={onVol}
      onInvert={onInvert}
      onReset={onReset}
    />,
  );
  const voiSelect = screen.getByLabelText('MPR window');
  expect(voiSelect).toBeDisabled();
  expect(screen.getByText('from header')).toBeInTheDocument();

  // 3D presets are still populated for MR (MR-Default, MR-T2-Brain).
  const volSelect = screen.getByLabelText('3D preset');
  expect(volSelect).not.toBeDisabled();
});
