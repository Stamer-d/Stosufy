// Lets Node run the Dash code as it is: its imports leave out the `.ts` (Vite finds them),
// so a relative import without an extension gets one here.
export async function resolve(specifier, context, next) {
	if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
		try {
			return await next(`${specifier}.ts`, context);
		} catch {
			// Not a .ts file: as it was
		}
	}
	return next(specifier, context);
}
