// @vitest-environment jsdom
/**
 * web.PropertiesPanel.test — parameterized over modeled block types.
 *
 * For each (type, fixture) pair: parse the fixture, mount <PropertiesForm/>
 * pointed at the matching block, assert the registry's allowedAttrs render as
 * inputs, and assert that on blur the onCommit mock is called with a fresh
 * MJML serialization.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import PropertiesForm from "../../web/src/canvas/PropertiesForm.js";
import {
  BLOCK_REGISTRY,
  parseMjml,
} from "../../src/shared/blocks/index.js";
import type {
  BlockNode,
  BlockType,
  MjmlDocument,
  TreeNode,
} from "../../src/shared/blocks/index.js";

afterEach(() => {
  cleanup();
});

function findFirstBlock(
  nodes: TreeNode[],
  type: BlockType
): BlockNode | undefined {
  for (const n of nodes) {
    if (n.type === type) return n as BlockNode;
    if (
      n.type !== "__unknown__" &&
      n.type !== "mj-custom-passthrough" &&
      n.children
    ) {
      const found = findFirstBlock(n.children, type);
      if (found) return found;
    }
  }
  return undefined;
}

interface Case {
  type: BlockType;
  source: string;
}

const SECTION = `<mjml><mj-body><mj-section background-color="#fff" padding="10px"><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>`;
const BUTTON = `<mjml><mj-body><mj-section><mj-column><mj-button href="#" background-color="#1f6feb">click</mj-button></mj-column></mj-section></mj-body></mjml>`;
const DIVIDER = `<mjml><mj-body><mj-section><mj-column><mj-divider border-color="#dddddd" /></mj-column></mj-section></mj-body></mjml>`;
const SPACER = `<mjml><mj-body><mj-section><mj-column><mj-spacer height="20px" /></mj-column></mj-section></mj-body></mjml>`;
const SOCIAL = `<mjml><mj-body><mj-section><mj-column><mj-social mode="horizontal" /></mj-column></mj-section></mj-body></mjml>`;
const TEXT = `<mjml><mj-body><mj-section><mj-column><mj-text font-size="14px" color="#222">hello</mj-text></mj-column></mj-section></mj-body></mjml>`;

const CASES: Case[] = [
  { type: "mj-section", source: SECTION },
  { type: "mj-button", source: BUTTON },
  { type: "mj-divider", source: DIVIDER },
  { type: "mj-spacer", source: SPACER },
  { type: "mj-social", source: SOCIAL },
  { type: "mj-text", source: TEXT },
];

describe("<PropertiesForm /> — parameterized", () => {
  it.each(CASES)(
    "renders all registry.allowedAttrs as inputs for $type",
    ({ type, source }) => {
      const doc: MjmlDocument = parseMjml(source);
      const node = findFirstBlock(doc.body, type);
      expect(node).toBeDefined();

      const onCommit = vi.fn();
      render(<PropertiesForm node={node!} doc={doc} onCommit={onCommit} />);

      const def = BLOCK_REGISTRY[type];
      for (const key of def.allowedAttrs) {
        const span = screen.queryByText(key);
        expect(
          span,
          `expected ${key} input to render for ${type}`
        ).not.toBeNull();
      }
    }
  );

  it("invokes onCommit with serialized MJML on blur", () => {
    const doc: MjmlDocument = parseMjml(BUTTON);
    const node = findFirstBlock(doc.body, "mj-button")!;
    const onCommit = vi.fn();

    render(<PropertiesForm node={node} doc={doc} onCommit={onCommit} />);

    // Find the href input by traversing the parent label of the "href" span.
    const span = screen.getByText("href");
    const input = span.parentElement!.querySelector("input")!;
    expect(input).not.toBeNull();

    // Simulate edit + blur.
    fireEvent.change(input, { target: { value: "https://newurl.example" } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const passed = onCommit.mock.calls[0]![0] as string;
    expect(typeof passed).toBe("string");
    expect(passed).toContain('href="https://newurl.example"');
  });
});
