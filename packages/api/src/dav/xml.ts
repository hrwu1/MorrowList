/**
 * The small XML surface WebDAV needs (GAP-25): read a request body into a namespace-aware
 * element tree, and escape text for the multistatus responses we write by hand.
 * Request bodies are short and machine-written (PROPFIND, REPORT, PROPPATCH), so this
 * reader covers well-formed elements, attributes, text, comments, CDATA, and the standard
 * entities, and nothing else. Anything malformed is a 400.
 */

export interface XmlElement {
  readonly ns: string;
  readonly name: string;
  /** Non-namespace attributes by local name (prefixes dropped). */
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlElement[];
  readonly text: string;
}

export const DAV = "DAV:";
export const CALDAV = "urn:ietf:params:xml:ns:caldav";
export const CALSERVER = "http://calendarserver.org/ns/";
export const APPLE = "http://apple.com/ns/ical/";

export class XmlError extends Error {}

const ENTITY: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? parseInt(ref.slice(2), 16)
          : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITY[ref.toLowerCase()] ?? match;
  });
}

interface Frame {
  ns: string;
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
  scope: Map<string, string>;
}

/** Parse a document; returns its root element. */
export function parseXml(source: string): XmlElement {
  // Strip a leading byte-order mark (U+FEFF) without writing the character itself here.
  const input = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const stack: Frame[] = [];
  let root: XmlElement | null = null;
  let position = 0;
  const tag =
    /<(\/)?([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/y;

  const open = (qname: string, attributes: string, selfClosing: boolean) => {
    const scope = new Map(
      stack.at(-1)?.scope ?? [
        ["", ""],
        ["xml", "http://www.w3.org/XML/1998/namespace"],
      ],
    );
    const attrs: Record<string, string> = {};
    for (const match of attributes.matchAll(
      /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
    )) {
      const attribute = match[1]!;
      const value = decode(match[2] ?? match[3] ?? "");
      if (attribute === "xmlns") scope.set("", value);
      else if (attribute.startsWith("xmlns:")) scope.set(attribute.slice(6), value);
      else attrs[attribute.slice(attribute.indexOf(":") + 1)] = value;
    }
    const colon = qname.indexOf(":");
    const prefix = colon === -1 ? "" : qname.slice(0, colon);
    const name = colon === -1 ? qname : qname.slice(colon + 1);
    const ns = scope.get(prefix);
    if (ns === undefined) throw new XmlError(`Unbound namespace prefix "${prefix}".`);
    const frame: Frame = { ns, name, attrs, children: [], text: "", scope };
    if (selfClosing) attach(frame);
    else stack.push(frame);
  };
  const attach = (frame: Frame) => {
    const element: XmlElement = {
      ns: frame.ns,
      name: frame.name,
      attrs: frame.attrs,
      children: frame.children,
      text: frame.text,
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(element);
    else if (root) throw new XmlError("More than one root element.");
    else root = element;
  };
  const close = (qname: string) => {
    const frame = stack.pop();
    if (!frame) throw new XmlError(`Unexpected closing tag </${qname}>.`);
    const colon = qname.indexOf(":");
    if ((colon === -1 ? qname : qname.slice(colon + 1)) !== frame.name)
      throw new XmlError(`Mismatched closing tag </${qname}>.`);
    attach(frame);
  };

  while (position < input.length) {
    const lt = input.indexOf("<", position);
    if (lt === -1) {
      if (input.slice(position).trim() && !stack.length)
        throw new XmlError("Text outside the root element.");
      appendText(stack, input.slice(position));
      break;
    }
    appendText(stack, input.slice(position, lt));
    if (input.startsWith("<!--", lt)) {
      const end = input.indexOf("-->", lt);
      if (end === -1) throw new XmlError("Unterminated comment.");
      position = end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", lt)) {
      const end = input.indexOf("]]>", lt);
      if (end === -1) throw new XmlError("Unterminated CDATA section.");
      const frame = stack.at(-1);
      if (frame) frame.text += input.slice(lt + 9, end);
      position = end + 3;
      continue;
    }
    if (input.startsWith("<?", lt) || input.startsWith("<!", lt)) {
      const end = input.indexOf(">", lt);
      if (end === -1) throw new XmlError("Unterminated declaration.");
      position = end + 1;
      continue;
    }
    tag.lastIndex = lt;
    const match = tag.exec(input);
    if (!match) throw new XmlError(`Malformed tag at offset ${lt}.`);
    const [, closing, qname, attributes, selfClosing] = match;
    if (closing) close(qname!);
    else open(qname!, attributes ?? "", Boolean(selfClosing));
    position = tag.lastIndex;
  }
  if (stack.length) throw new XmlError(`Unclosed element <${stack.at(-1)!.name}>.`);
  if (!root) throw new XmlError("Empty document.");
  return root;
}

function appendText(stack: Frame[], raw: string) {
  const frame = stack.at(-1);
  if (frame && raw) frame.text += decode(raw);
}

/** Direct children with the given namespace and local name. */
export function childrenOf(
  element: XmlElement,
  ns: string,
  name: string,
): XmlElement[] {
  return element.children.filter((child) => child.ns === ns && child.name === name);
}
export function childOf(
  element: XmlElement,
  ns: string,
  name: string,
): XmlElement | null {
  return childrenOf(element, ns, name)[0] ?? null;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // eslint-disable-line no-control-regex
}
