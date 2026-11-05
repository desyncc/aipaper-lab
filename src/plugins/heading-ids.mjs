// Portable heading ids: `## Some heading {#my-id}`.
//
// Astro's default slugger derives ids from the heading text, which makes links
// brittle the moment a heading is reworded. This plugin strips a trailing
// `{#id}` from the last text node and sets the id explicitly; rehype-slug leaves
// existing ids alone. No dependencies on purpose — this site should still build
// from a clean checkout in a decade.
const ID = /\s*\{#([A-Za-z0-9_-]+)\}\s*$/;

function walk(node, fn) {
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, fn);
}

export default function headingIds() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type !== 'heading' || !node.children?.length) return;
      const last = node.children[node.children.length - 1];
      if (last.type !== 'text') return;
      const match = last.value.match(ID);
      if (!match) return;
      last.value = last.value.slice(0, match.index).trimEnd();
      node.data = node.data || {};
      node.data.hProperties = { ...(node.data.hProperties || {}), id: match[1] };
    });
  };
}
