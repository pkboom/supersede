import { createHash } from "node:crypto";
import { parse } from "parse5";

function stripMarkers(value) {
  return value
    .replace(/[⟦⟧]/gu, "")
    .replace(/<\/?\s*email_(?:html|data)(?:_(?:start|end))?\s*\/?>|\bemail_(?:html|data)(?:_(?:start|end))?\b/giu, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function minifyHtmlForLuna(value) {
  return value
    .replace(/<!--([\s\S]*?)-->/gu, (comment, body) =>
      /^\s*(?:\[if\b|<!\[endif\])/iu.test(body) ? comment : "",
    )
    .replace(/\b(href|src|background|action)\s*=\s*(["'])([\s\S]*?)\2/giu, (attribute, name, quote, content) => {
      const marker = content.match(/^⟦[a-z]+-\d+⟧/u)?.[0] ?? "";
      const value = content.slice(marker.length);
      if (value.length <= 120) return attribute;
      return `${name}=${quote}${marker}[opaque:${sha256(value).slice(0, 12)}]${quote}`;
    })
    .replace(/\s+/gu, " ")
    .replace(/>\s+</gu, "><")
    .trim();
}

const ENTITIES = {
  "&bull;": "•",
  "&copy;": "©",
  "&reg;": "®",
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&apos;": "'",
  "&mdash;": "—",
  "&ndash;": "–",
};

export function normalizeForComparison(value) {
  return value
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&[a-z]+;/giu, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/<br\s*\/?>/giu, " ")
    .replace(/<[^>]*>/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

export function decodeHtml(buffer, file = "HTML file") {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${file} is not valid UTF-8; refusing to risk byte corruption.`);
  }
  const declarations = [];
  for (const match of source.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = match[0];
    const direct = tag.match(/\bcharset\s*=\s*["']?([^\s"'/>;]+)/iu)?.[1];
    const content = tag.match(/\bcontent\s*=\s*["'][^"']*\bcharset\s*=\s*([^\s"';>]+)/iu)?.[1];
    if (direct) declarations.push(direct.toLowerCase());
    if (content) declarations.push(content.toLowerCase());
  }
  const unsupported = declarations.find((declared) => !["utf-8", "utf8", "us-ascii"].includes(declared));
  if (unsupported) {
    throw new Error(`${file} declares unsupported charset ${unsupported}.`);
  }
  return source;
}

export function buildElementAnnotatedView(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const list = [];
  let count = 0;
  const visit = (node) => {
    const location = node.sourceCodeLocation;
    if (node.tagName && location?.startTag && location.endOffset > location.startOffset) {
      count += 1;
      list.push({
        id: `element-${String(count).padStart(5, "0")}`,
        tagName: node.tagName,
        markerOffset: location.startTag.startOffset,
        start: location.startOffset,
        end: location.endOffset,
        html: source.slice(location.startOffset, location.endOffset),
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (node.content) visit(node.content);
  };
  visit(document);
  list.sort((left, right) => left.markerOffset - right.markerOffset);
  const elements = new Map(list.map((element) => [element.id, element]));
  let cursor = 0;
  let html = "";
  for (const element of list) {
    html += stripMarkers(source.slice(cursor, element.markerOffset).replace(/\s+/gu, " "));
    html += `⟦${element.id}⟧`;
    cursor = element.markerOffset;
  }
  html += stripMarkers(source.slice(cursor));
  return { html: minifyHtmlForLuna(html), elements };
}
