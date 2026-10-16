// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { buildSchema } from 'graphql';
import QueryEditor from './QueryEditor.jsx';

// CodeMirror's own completion behaviour is the library's responsibility and needs a
// real layout engine to exercise meaningfully — that is verified in the browser.
// These tests cover the wiring this project owns: mounting, value synchronisation,
// change reporting, and surviving a schema that is absent or arrives late.

afterEach(cleanup);

const schema = buildSchema('type Query { hello: String }');

function editorText(container) {
  return container.querySelector('.cm-content')?.textContent ?? '';
}

describe('QueryEditor mounting', () => {
  it('renders a CodeMirror instance', () => {
    const { container } = render(<QueryEditor value="" onChange={() => {}} />);
    expect(container.querySelector('.cm-editor')).toBeTruthy();
  });

  it('shows the initial value', () => {
    const { container } = render(<QueryEditor value="{ hello }" onChange={() => {}} />);
    expect(editorText(container)).toContain('{ hello }');
  });

  it('mounts with no schema — the editor must work before introspection', () => {
    const { container } = render(<QueryEditor value="{ hello }" onChange={() => {}} schema={null} />);
    expect(container.querySelector('.cm-editor')).toBeTruthy();
  });

  it('mounts with a schema', () => {
    const { container } = render(<QueryEditor value="{ hello }" onChange={() => {}} schema={schema} />);
    expect(container.querySelector('.cm-editor')).toBeTruthy();
  });
});

describe('QueryEditor value synchronisation', () => {
  it('applies an externally changed value, as when a saved request is opened', () => {
    const { container, rerender } = render(<QueryEditor value="{ a }" onChange={() => {}} />);
    rerender(<QueryEditor value="{ b }" onChange={() => {}} />);
    expect(editorText(container)).toContain('{ b }');
  });

  it('does not report a change when the value is pushed in from outside', () => {
    // Echoing an external update back through onChange would loop against the
    // parent's state.
    const onChange = vi.fn();
    const { rerender } = render(<QueryEditor value="{ a }" onChange={onChange} />);
    onChange.mockClear();
    rerender(<QueryEditor value="{ a }" onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('accepts a schema arriving after mount without losing the query', () => {
    // Introspection finishes while the user already has a query typed.
    const { container, rerender } = render(<QueryEditor value="{ hello }" onChange={() => {}} schema={null} />);
    rerender(<QueryEditor value="{ hello }" onChange={() => {}} schema={schema} />);
    expect(editorText(container)).toContain('{ hello }');
  });
});

describe('QueryEditor teardown', () => {
  it('destroys the editor on unmount', () => {
    const { container, unmount } = render(<QueryEditor value="{ hello }" onChange={() => {}} />);
    expect(container.querySelector('.cm-editor')).toBeTruthy();
    unmount();
    expect(container.querySelector('.cm-editor')).toBeNull();
  });
});
