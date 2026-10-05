export const MAX_BOT_BYTES = 2 * 1024 * 1024;
export interface BotField { path: number[]; name: string; value: string }
export interface BotBlock { path: number[]; type: string; depth: number; fields: BotField[]; disabled: boolean }
export function parseBotXml(source: string): XMLDocument {
  if (!source.trim()) throw new Error('Upload an XML bot to begin.');
  if (new TextEncoder().encode(source).length > MAX_BOT_BYTES) throw new Error('Choose an XML file smaller than 2 MB.');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('XML declarations containing external entities are not supported.');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid XML. Fix the source before saving or downloading.');
  if (document.documentElement.localName !== 'xml') throw new Error('Expected a Blockly bot XML file with an <xml> root.');
  return document;
}
export function botElementAt(document: XMLDocument, path: number[]): Element {
  let element: Element = document.documentElement;
  for (const index of path) {
    const child = element.children.item(index);
    if (!child) throw new Error('The bot changed. Select the field again.');
    element = child;
  }
  return element;
}
export function botBlocks(document: XMLDocument): BotBlock[] {
  const blocks: BotBlock[] = [];
  const walk = (element: Element, path: number[], depth: number) => {
    const isBlock = element.localName === 'block' || element.localName === 'shadow';
    if (isBlock) {
      const fields: BotField[] = [];
      Array.from(element.children).forEach((child, index) => {
        if (child.localName === 'field') fields.push({ path: [...path, index], name: child.getAttribute('name') ?? 'Field', value: child.textContent ?? '' });
      });
      blocks.push({ path, type: element.getAttribute('type') ?? element.localName, depth, fields, disabled: element.getAttribute('disabled') === 'true' });
    }
    Array.from(element.children).forEach((child, index) => walk(child, [...path, index], depth + (isBlock ? 1 : 0)));
  };
  walk(document.documentElement, [], 0);
  return blocks;
}
export function updateBotField(source: string, path: number[], value: string): string {
  const document = parseBotXml(source);
  const field = botElementAt(document, path);
  if (field.localName !== 'field') throw new Error('Select a bot field.');
  field.textContent = value;
  return new XMLSerializer().serializeToString(document);
}
export function setBotBlockDisabled(source: string, path: number[], disabled: boolean): string {
  const document = parseBotXml(source);
  const block = botElementAt(document, path);
  if (!['block', 'shadow'].includes(block.localName)) throw new Error('Select a bot block.');
  if (disabled) block.setAttribute('disabled', 'true'); else block.removeAttribute('disabled');
  return new XMLSerializer().serializeToString(document);
}
export function botFilename(name: string): string {
  const safe = name.trim().replace(/[^a-zA-Z0-9 _.-]/g, '_').replace(/\.xml$/i, '').slice(0, 100);
  return `${safe || 'circletool-bot'}.xml`;
}
