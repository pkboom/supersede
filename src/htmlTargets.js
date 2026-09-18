import { createHash } from "node:crypto";
import { parse } from "parse5";

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "title", "textarea", "noscript", "iframe", "xmp"]);

export function stripMarkers(value) {
  return value
    .replace(/[⟦⟧]/gu, "")
    .replace(/<\/?\s*email_(?:html|data)(?:_(?:start|end))?\s*\/?>|\bemail_(?:html|data)(?:_(?:start|end))?\b/giu, "");
}

export function sha256(value) {
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

function elementKey(node) {
  const attributes = new Map((node.attrs ?? []).map((attribute) => [attribute.name, attribute.value]));
  const id = attributes.get("id") ? `#${attributes.get("id")}` : "";
  const classes = (attributes.get("class") ?? "")
    .split(/\s+/u)
    .filter(Boolean)
    .map((name) => `.${name}`)
    .join("");
  return `${node.tagName ?? node.nodeName}${id}${classes}`;
}

function nodeContext(node) {
  const parts = [];
  let current = node;
  while (current && parts.length < 4) {
    if (current.tagName) parts.unshift(elementKey(current));
    current = current.parentNode;
  }
  return parts.join(" > ");
}

function descendantText(node, limit = 120) {
  let text = "";
  const visit = (current) => {
    if (text.length >= limit) return;
    if (current.nodeName === "#text") text += ` ${current.value}`;
    for (const child of current.childNodes ?? []) visit(child);
  };
  visit(node);
  return text.replace(/\s+/gu, " ").trim().slice(0, limit);
}

function attributeValueLocation(raw, absoluteStart) {
  const equals = raw.indexOf("=");
  if (equals === -1) return null;
  let cursor = equals + 1;
  while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
  const quote = raw[cursor] === '"' || raw[cursor] === "'" ? raw[cursor] : "";
  const valueStart = cursor + (quote ? 1 : 0);
  let valueEnd = raw.length;
  if (quote) {
    const closing = raw.lastIndexOf(quote);
    if (closing <= cursor) return null;
    valueEnd = closing;
  }
  return { start: absoluteStart + valueStart, end: absoluteStart + valueEnd, quote };
}

function collectTargets(node, source, targets, counters) {
  const location = node.sourceCodeLocation;
  if (node.tagName && location?.attrs) {
    for (const [attributeName, attributeLocation] of Object.entries(location.attrs)) {
      const raw = source.slice(attributeLocation.startOffset, attributeLocation.endOffset);
      const valueLocation = attributeValueLocation(raw, attributeLocation.startOffset);
      if (!valueLocation || valueLocation.end < valueLocation.start) continue;
      counters.attribute += 1;
      targets.push({
        id: `attribute-${String(counters.attribute).padStart(5, "0")}`,
        kind: "attribute",
        tagName: node.tagName,
        attributeName,
        context: `${nodeContext(node)} text=${JSON.stringify(descendantText(node))}`,
        ...valueLocation,
        source: source.slice(valueLocation.start, valueLocation.end),
      });
    }
  }
  if (node.nodeName === "#text" && location && !RAW_TEXT_ELEMENTS.has(node.parentNode?.tagName)) {
    const raw = source.slice(location.startOffset, location.endOffset);
    const leading = raw.match(/^\s*/u)?.[0].length ?? 0;
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0;
    const start = location.startOffset + leading;
    const end = location.endOffset - trailing;
    if (end > start) {
      counters.text += 1;
      targets.push({
        id: `text-${String(counters.text).padStart(5, "0")}`,
        kind: "text",
        tagName: node.parentNode?.tagName,
        context: nodeContext(node.parentNode),
        start,
        end,
        quote: "",
        source: source.slice(start, end),
      });
    }
  }
  for (const child of node.childNodes ?? []) collectTargets(child, source, targets, counters);
  if (node.content) collectTargets(node.content, source, targets, counters);
}

export function buildAnnotatedView(source) {
  const document = parse(source, { sourceCodeLocationInfo: true });
  const list = [];
  collectTargets(document, source, list, { attribute: 0, text: 0 });
  list.sort((left, right) => left.start - right.start || left.end - right.end);
  const targets = new Map();
  let cursor = 0;
  let html = "";
  for (const target of list) {
    if (target.start < cursor) continue;
    target.sha256 = sha256(target.source);
    targets.set(target.id, target);
    html += stripMarkers(source.slice(cursor, target.start).replace(/\s+/gu, " "));
    html += `⟦${target.id}⟧${stripMarkers(target.source)}`;
    cursor = target.end;
  }
  html += stripMarkers(source.slice(cursor));
  return { html: minifyHtmlForLuna(html), targets };
}

export function assertSafeReplacement(target, replacement) {
  if (typeof replacement !== "string" || replacement === target.source) {
    throw new Error(`Invalid or unchanged replacement for ${target.id}.`);
  }
  if (target.kind === "text" && replacement.includes("<")) {
    throw new Error(`Structural markup is not allowed in text target ${target.id}.`);
  }
  if (target.kind === "attribute") {
    if (target.quote && replacement.includes(target.quote)) {
      throw new Error(`Replacement for ${target.id} contains its unescaped attribute quote.`);
    }
    if (!target.quote && /[\s"'`=<>]/u.test(replacement)) {
      throw new Error(`Replacement for unquoted attribute ${target.id} is not safe.`);
    }
  }
}

export function materializeEdits(source, proposedEdits, view = buildAnnotatedView(source)) {
  const seen = new Set();
  return proposedEdits.map((edit) => {
    if (seen.has(edit.targetId)) throw new Error(`Duplicate target ${edit.targetId}.`);
    seen.add(edit.targetId);
    const target = view.targets.get(edit.targetId);
    if (!target) throw new Error(`Unknown target ${edit.targetId}.`);
    assertSafeReplacement(target, edit.replacement);
    return {
      targetId: target.id,
      kind: target.kind,
      tagName: target.tagName,
      attributeName: target.attributeName,
      quote: target.quote,
      context: target.context,
      before: target.source,
      beforeSha256: target.sha256,
      replacement: edit.replacement,
      reason: edit.reason,
    };
  });
}

export function applyMaterializedEdits(source, edits) {
  const view = buildAnnotatedView(source);
  const seen = new Set();
  const replacements = edits.map((edit) => {
    if (seen.has(edit.targetId)) throw new Error(`Duplicate target ${edit.targetId}.`);
    seen.add(edit.targetId);
    const target = view.targets.get(edit.targetId);
    if (!target || target.source !== edit.before || target.sha256 !== edit.beforeSha256) {
      throw new Error(`Target ${edit.targetId} is stale or invalid.`);
    }
    assertSafeReplacement(target, edit.replacement);
    return { start: target.start, end: target.end, replacement: edit.replacement };
  });
  replacements.sort((left, right) => right.start - left.start);
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index].end > replacements[index - 1].start) {
      throw new Error("Overlapping edit spans; refusing an ambiguous replay.");
    }
  }
  let output = source;
  for (const edit of replacements) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  return output;
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
