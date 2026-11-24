// The note an "insert" goes into. Clicking inside the gallery makes the gallery the active leaf,
// so workspace.activeLeaf is never the note the user means; take the most recent Markdown editor.
export function findTargetEditor(app) {
  const active = app.workspace.activeEditor;
  if (active?.editor) return { editor: active.editor, file: active.file || null };
  let best = null;
  app.workspace.iterateAllLeaves(leaf => {
    const view = leaf.view;
    if (view?.getViewType?.() !== 'markdown' || !view.editor) return;
    if (!best || (leaf.activeTime || 0) > (best.leaf.activeTime || 0)) best = { leaf, view };
  });
  return best ? { editor: best.view.editor, file: best.view.file || null } : null;
}
