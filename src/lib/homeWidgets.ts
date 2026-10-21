// Putting a widget on the home screen from elsewhere (a webcam or a stop of the world
// center), with what it shows already set

import { get } from 'svelte/store';
import { userSettings, updateHomeSettings } from './stores/user';
import { setWidgetData } from './stores/widgetData';
import { showToast } from './stores/toast';

export async function addWidget(type: string, data: Record<string, unknown> = {}, name = 'widget') {
	// The list of widgets imports the widgets themselves (which may import their sources)
	const { DEFAULT_WIDGETS } = await import('./widgets');
	const placed = get(userSettings).settings?.home?.widgets ?? DEFAULT_WIDGETS;
	const uid = `${type}-${Date.now()}`;
	if (Object.keys(data).length) setWidgetData(uid, data);
	const offset = (placed.length % 5) * 0.06;
	updateHomeSettings({
		widgets: [...placed, { uid, type, x: 0.3 + offset, y: 0.25 + offset }]
	});
	showToast(`Added ${name} to the home screen`);
}
