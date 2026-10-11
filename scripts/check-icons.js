// Fails when the code uses an icon class that doesn't exist: the Iconify Tailwind plugin
// silently generates nothing for unknown names, which leaves an invisible button.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sets = new Map();
const missing = [];

function files(dir) {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

for (const file of files('src').filter((f) => /\.(svelte|ts|js)$/.test(f))) {
	for (const [, prefix, name] of readFileSync(file, 'utf8').matchAll(
		/icon-\[([a-z0-9-]+)--([a-z0-9-]+)\]/g
	)) {
		if (!sets.has(prefix)) sets.set(prefix, require(`@iconify/json/json/${prefix}.json`));
		const set = sets.get(prefix);
		if (!set.icons[name] && !set.aliases?.[name]) missing.push(`${file}: ${prefix}--${name}`);
	}
}

if (missing.length) {
	console.error(`Unknown icons:\n${missing.join('\n')}`);
	process.exit(1);
}
console.log('All icons exist');
