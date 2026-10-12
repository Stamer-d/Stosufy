// A canvas off the page. WebView2 and newer WebKit have OffscreenCanvas; older WebKit (macOS
// before 13.3, older Linux distributions) gets a canvas element that does the same.

export function offscreenCanvas(width: number, height: number): OffscreenCanvas {
	if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return Object.assign(canvas, {
		convertToBlob: (options?: ImageEncodeOptions) =>
			new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					(blob) => (blob ? resolve(blob) : reject(new Error('Could not make the picture'))),
					options?.type,
					options?.quality
				)
			),
		// (Drawing takes a canvas just as well as a bitmap)
		transferToImageBitmap: () => canvas
	}) as unknown as OffscreenCanvas;
}
