/** A size to read: "512 B", "3.4 MB", "245 MB", "1.2 GB" */
export function sizeText(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? +value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
