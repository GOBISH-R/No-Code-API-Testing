import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, placeholder as cmPlaceholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { graphql, updateSchema } from 'cm6-graphql';
import './graphql-tools.css';

// Matches the app's own palette rather than shipping a second theme, so the editor
// reads as part of the product instead of an embedded widget.
const appTheme = EditorView.theme(
  {
    '&': { fontSize: '0.82rem', backgroundColor: 'transparent' },
    '.cm-content': { fontFamily: 'var(--mono)', padding: '0.5rem 0' },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: 'var(--text-muted)',
      opacity: 0.5,
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel-bg)',
      border: '1px solid var(--panel-border)',
      borderRadius: '6px',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'var(--accent-bg)',
      color: 'var(--accent)',
    },
  },
  { dark: true },
);

/**
 * A GraphQL-aware query editor.
 *
 * Schema-driven completion comes from cm6-graphql rather than any bespoke matching:
 * it parses the document and knows what is legal at the cursor, which is the only way
 * nested fields, arguments and enum values can be suggested correctly.
 *
 * The editor is created once and kept alive; the value and the schema are pushed into
 * it. Recreating it per render would destroy cursor position and undo history on
 * every keystroke.
 */
export default function QueryEditor({ value, onChange, schema, placeholder }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  // Held in a ref so a changing handler identity never forces the editor to be rebuilt.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: value ?? '',
        extensions: [
          lineNumbers(),
          history(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          autocompletion({ activateOnTyping: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          EditorView.lineWrapping,
          appTheme,
          placeholder ? cmPlaceholder(placeholder) : [],
          graphql(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current?.(update.state.doc.toString());
          }),
        ],
      }),
      parent: hostRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount-only: value and schema are synchronised by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push external value changes in (loading a saved request, resetting the builder)
  // without disturbing the cursor while the user is typing.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const current = view.state.doc.toString();
    if ((value ?? '') !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value ?? '' } });
    }
  }, [value]);

  // Re-point the live editor at a schema as soon as one is introspected — no rebuild,
  // so the user keeps whatever they had typed.
  useEffect(() => {
    if (viewRef.current) updateSchema(viewRef.current, schema ?? undefined);
  }, [schema]);

  return <div className="query-editor" ref={hostRef} />;
}
