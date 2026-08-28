/**
 * "No template selected" placeholder. The sidebar's "+ New" button creates
 * one and navigates to `/templates/:id`.
 */
export function TemplateEmpty() {
  return (
    <main className="route-empty" data-testid="route-empty">
      <h2>No template selected</h2>
      <p>Pick a template from the sidebar, or click <strong>+ New</strong> to create one.</p>
    </main>
  );
}
