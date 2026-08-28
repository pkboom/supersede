// @vitest-environment jsdom
/**
 * web.RightPanel.test — assert tabbed properties panel:
 *  - "Block" tab with mj-image selection shows form inputs labelled
 *    src / alt / width / align / padding / href.
 *  - "Settings" tab shows subject + preheader inputs.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import RightPanel from "../../web/src/canvas/RightPanel.js";
import {
  parseMjml,
  type MjmlDocument,
} from "../../src/shared/blocks/index.js";

afterEach(() => {
  cleanup();
});

const MJML_WITH_IMAGE = `<mjml>
  <mj-head>
    <mj-title>My Subject</mj-title>
    <mj-preview>My Preheader</mj-preview>
  </mj-head>
  <mj-body>
    <mj-section>
      <mj-column>
        <mj-image src="https://placehold.co/600x300" alt="hero" />
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

// Phase-6 prop shape: selection is owned by Canvas; RightPanel takes
// `selectedPath` + `onSelectionChange` directly.
const noop = () => undefined;

describe("<RightPanel />", () => {
  it("Block tab with mj-image selection shows the image attr inputs", () => {
    const doc: MjmlDocument = parseMjml(MJML_WITH_IMAGE);
    const onCommit = vi.fn();

    render(<RightPanel doc={doc} selectedPath={[0, 0, 0]} onSelectionChange={noop} onCommit={onCommit} />);

    // Click the "Block" tab.
    fireEvent.click(screen.getByRole("tab", { name: /block/i }));

    // The form labels render as `<span>{key}</span>` inside <label>. We pull
    // them by text content.
    const expectedLabels = ["src", "alt", "width", "align", "padding", "href"];
    for (const key of expectedLabels) {
      const span = screen.queryByText(key);
      expect(span, `expected ${key} input to render`).not.toBeNull();
    }
  });

  it("Settings tab shows subject + preheader inputs prefilled from mj-title/mj-preview", () => {
    const doc: MjmlDocument = parseMjml(MJML_WITH_IMAGE);
    const onCommit = vi.fn();

    render(<RightPanel doc={doc} selectedPath={null} onSelectionChange={noop} onCommit={onCommit} />);

    // Settings tab is the default — but still click it to be explicit.
    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));

    expect(screen.getByText(/subject/i)).not.toBeNull();
    expect(screen.getByText(/preheader/i)).not.toBeNull();

    // The two input boxes should be populated with the parsed head values.
    const subjectSpan = screen.getByText(/^subject$/i);
    const subjectInput = subjectSpan.parentElement?.querySelector("input");
    expect(subjectInput?.value).toBe("My Subject");

    const preheaderSpan = screen.getByText(/^preheader$/i);
    const preheaderInput = preheaderSpan.parentElement?.querySelector("input");
    expect(preheaderInput?.value).toBe("My Preheader");
  });

  it("Settings tab Layout group: edits mj-body width via bodyAttrs round-trip", () => {
    const doc: MjmlDocument = parseMjml(
      `<mjml><mj-head></mj-head><mj-body width="600px"></mj-body></mjml>`
    );
    expect(doc.bodyAttrs?.get("width")).toBe("600px");
    const onCommit = vi.fn();

    render(<RightPanel doc={doc} selectedPath={null} onSelectionChange={noop} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));

    const widthSpan = screen.getByText(/^email width$/i);
    const widthInput = widthSpan.parentElement?.querySelector(
      'input[type="text"]'
    ) as HTMLInputElement;
    expect(widthInput.value).toBe("600px");

    fireEvent.change(widthInput, { target: { value: "640px" } });
    fireEvent.blur(widthInput);
    expect(onCommit).toHaveBeenCalled();
    const out = onCommit.mock.calls.at(-1)![0] as string;
    expect(out).toContain('width="640px"');
  });

  it("Settings tab Typography defaults: select changes default font family via mj-attributes", () => {
    const doc: MjmlDocument = parseMjml(
      `<mjml><mj-head><mj-attributes><mj-all font-family="Arial, Helvetica, sans-serif" /></mj-attributes></mj-head><mj-body></mj-body></mjml>`
    );
    const onCommit = vi.fn();

    render(<RightPanel doc={doc} selectedPath={null} onSelectionChange={noop} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));

    const fontSpan = screen.getByText(/^default font family$/i);
    const select = fontSpan.parentElement?.querySelector(
      "select"
    ) as HTMLSelectElement;
    expect(select.value).toBe("Arial, Helvetica, sans-serif");

    fireEvent.change(select, { target: { value: "Georgia, serif" } });
    expect(onCommit).toHaveBeenCalled();
    const out = onCommit.mock.calls.at(-1)![0] as string;
    expect(out).toContain('font-family="Georgia, serif"');
  });

  it("Settings tab default text color: color swatch flushes on change via mj-attributes", () => {
    const doc: MjmlDocument = parseMjml(
      `<mjml><mj-head></mj-head><mj-body></mj-body></mjml>`
    );
    const onCommit = vi.fn();

    render(<RightPanel doc={doc} selectedPath={null} onSelectionChange={noop} onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("tab", { name: /settings/i }));

    const span = screen.getByText(/^default text color$/i);
    const swatch = span.parentElement?.querySelector(
      'input[type="color"]'
    ) as HTMLInputElement;
    expect(swatch).not.toBeNull();

    fireEvent.change(swatch, { target: { value: "#112233" } });
    expect(onCommit).toHaveBeenCalled();
    const out = onCommit.mock.calls.at(-1)![0] as string;
    expect(out).toContain("<mj-attributes>");
    expect(out).toContain('<mj-text color="#112233" />');
  });
});
