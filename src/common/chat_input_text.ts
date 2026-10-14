/** Browser expression, not a serialized TS callback (avoids injected build helpers).
 * Read logical contenteditable lines; innerText adds a layout newline for <div><br></div>.
 * Do not collapse whitespace: missing/extra blank lines must still fail send validation.
 */
export const CHAT_INPUT_TEXT_READER = String.raw`(el) => {
  if (!el) return null;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value;
  if (!el.isContentEditable) throw new Error('聊天输入框不是可编辑元素');
  const blocks = new Set(['DIV', 'P']);
  const inline = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S']);
  function read(container) {
    const nodes = Array.from(container.childNodes);
    // Chrome uses a lone BR to keep an empty editable line focusable.
    if ((blocks.has(container.tagName) || container === el) && nodes.length === 1 && nodes[0].nodeType === 1 && nodes[0].tagName === 'BR') return '';
    let text = '';
    let previousBlock = false;
    let seen = false;
    for (const node of nodes) {
      if (node.nodeType === 8) continue;
      if (node.nodeType !== 1 && node.nodeType !== 3) throw new Error('聊天输入框包含不支持的节点类型：' + node.nodeType);
      const block = node.nodeType === 1 && blocks.has(node.tagName);
      if (seen && (previousBlock || block)) text += '\n';
      if (node.nodeType === 3) text += node.data;
      else if (node.tagName === 'BR') text += '\n';
      else if (block || inline.has(node.tagName)) text += read(node);
      else throw new Error('聊天输入框包含不支持的元素：' + node.tagName);
      previousBlock = block;
      seen = true;
    }
    return text;
  }
  return read(el);
}`;
