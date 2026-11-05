// Blink 109 invalidates var(--empty,) when --empty is registered without an initial value.
// Keep Tailwind's registrations on newer engines; reset the unregistered legacy properties
// in Tailwind's lowest layer so inheritance still matches inherits:false.
module.exports = () => ({
  postcssPlugin: 'picpony-chrome109',
  OnceExit(root, { postcss }) {
    const properties = [];
    root.walkAtRules('property', (rule) => {
      if (rule.params.startsWith('--tw-') && !rule.nodes.some((node) => node.prop === 'initial-value')) {
        properties.push(rule);
      }
    });
    if (!properties.length) return;

    const condition = '(color: color-mix(in srgb, currentColor, transparent))';
    const modern = postcss.atRule({ name: 'supports', params: condition });
    const legacy = postcss.atRule({ name: 'supports', params: `not ${condition}` });
    const defaults = postcss.rule({ selector: '*, ::before, ::after, ::backdrop' });
    for (const property of properties) {
      defaults.append({ prop: property.params, value: 'initial' });
      modern.append(property.clone());
      property.remove();
    }
    legacy.append(defaults);
    root.prepend(postcss.atRule({ name: 'layer', params: 'properties' }));
    root.append(modern, postcss.atRule({ name: 'layer', params: 'properties' }).append(legacy));
  },
});
module.exports.postcss = true;
