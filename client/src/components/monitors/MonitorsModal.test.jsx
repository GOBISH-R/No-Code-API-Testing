// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MonitorsModal from './MonitorsModal.jsx';

afterEach(cleanup);

const collections = [{ _id: 'c1', name: 'Payments API' }];
const environments = [{ _id: 'e1', name: 'Staging' }];

function monitor(overrides = {}) {
  return {
    _id: 'm1',
    name: 'Every 5 minutes',
    collectionId: 'c1',
    environmentId: 'e1',
    intervalMinutes: 5,
    enabled: true,
    alertEmail: true,
    alertWebhookUrl: '',
    nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

function open(monitors) {
  const update = vi.fn(async () => ({}));
  render(
    <MonitorsModal
      monitorsState={{
        monitors,
        status: 'ready',
        runningIds: new Set(),
        refresh: vi.fn(),
        create: vi.fn(),
        update,
        remove: vi.fn(),
        runNow: vi.fn(),
      }}
      collections={collections}
      environments={environments}
      testRunsState={{ openRun: vi.fn(), selectedRun: null, closeRun: vi.fn() }}
      onClose={() => {}}
    />,
  );
  return { update };
}

const environmentSelect = () => screen.getAllByRole('combobox').find((s) => [...s.options].some((o) => o.text === 'No environment'));

describe('MonitorsModal', () => {
  it('editing keeps the monitor’s environment', () => {
    open([monitor()]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(environmentSelect().value).toBe('e1');
  });

  it('a monitor whose environment was deleted edits as "No environment", not a dead id', () => {
    open([monitor({ environmentId: 'gone' })]);
    expect(screen.getByText(/Deleted environment/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(environmentSelect().value).toBe('');
  });
});
