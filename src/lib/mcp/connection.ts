// The window's side of the Claude connection: the app (src-tauri/src/mcp.rs) hands over
// Claude's tool calls, the tools run here (tools.ts) and their answers go back. The settings
// (ClaudeSettings.svelte) turn it on and add Stosufy to Claude. Claude's connector on the
// server (api.stamer-d.de/v2/stosufy/mcp, for the phone and claude.ai) hands the tools that need
// this app (the downloaded songs, downloads, mixes) here too, over Stosufy Connect.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { get, writable } from 'svelte/store';
import { TOOLS } from './tools';
import { ToolError } from './songs';
import toolList from './tools.json';
import * as api from '../api';
import { freshToken } from '../stores/auth';
import { connect, onConnectCommand, setClaudeAbility } from '../stores/connect';

export interface ClaudeStatus {
	enabled: boolean;
	allowChanges: boolean;
	running: boolean;
	port: number | null;
	/** What Claude starts: Stosufy with these arguments */
	command: string;
	args: string[];
	/** Claude Code has Stosufy */
	claudeCode: boolean;
}

export interface DesktopStatus {
	installed: boolean;
	connected: boolean;
	/** Stosufy is in Claude's settings, but from another install */
	outdated: boolean;
	paths: string[];
}

/** What Claude did last (for the settings): when, which tool */
export const claudeActivity = writable<{ at: number; tool: string; calls: number } | null>(null);

const titles = Object.fromEntries(toolList.map((tool) => [tool.name, tool.title]));
const looksOnly = new Set(
	toolList.filter((tool) => tool.annotations?.readOnlyHint).map((tool) => tool.name)
);

const TURNED_OFF =
	"Claude's access to Stosufy's desktop app is turned off. The user can turn it on in Stosufy: Settings → Claude.";
const NO_CHANGES =
	'The user lets Claude only look at Stosufy, not change anything (Stosufy: Settings → Claude → "Let Claude make changes"). Tell them what you would do, or ask them to allow changes.';

/** A tool's answer as MCP has it: what it found as JSON text, or what went wrong */
async function run(name: string, args: Record<string, unknown>) {
	claudeActivity.update((last) => ({
		at: Date.now(),
		tool: titles[name] ?? name,
		calls: (last?.calls ?? 0) + 1
	}));
	const tool = TOOLS[name];
	if (!tool) return failed(`Stosufy has no tool "${name}".`);
	try {
		const result = await tool(args ?? {});
		const text = typeof result === 'string' ? result : JSON.stringify(result);
		return { content: [{ type: 'text', text }] };
	} catch (error) {
		if (error instanceof ToolError) return failed(error.message);
		console.error(`Claude's ${name} failed:`, error);
		return failed(
			`Something went wrong in Stosufy: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

const failed = (text: string) => ({ content: [{ type: 'text', text }], isError: true });

/**
 * A tool call of Claude that came through Stosufy's server (the connector on the user's phone or
 * claude.ai): run here as if Claude asked the app itself, then the answer goes back
 */
async function runForServer(data: {
	id: string;
	tool: string;
	args: Record<string, unknown>;
	readOnly: boolean;
}) {
	const status = await claudeStatus().catch(() => null);
	const result = !status?.enabled
		? failed(TURNED_OFF)
		: !looksOnly.has(data.tool) && (data.readOnly || !status.allowChanges)
			? failed(NO_CHANGES)
			: await run(data.tool, data.args ?? {});
	await api
		.answerConnectMcp(await freshToken(), get(connect).deviceId, data.id, result)
		.catch((error) => console.error('Could not answer Claude (server):', error));
}

let started = false;

/** Listens for Claude's tool calls (once, when the app starts) */
export async function startClaudeConnection() {
	if (started) return;
	started = true;
	onConnectCommand('mcp', runForServer);
	claudeStatus()
		.then((status) => setClaudeAbility(status.enabled))
		.catch(() => {});
	try {
		await listen<{ id: number; name: string; arguments: Record<string, unknown> }>(
			'mcp-call',
			async ({ payload }) => {
				const result = await run(payload.name, payload.arguments);
				await invoke('mcp_reply', { id: payload.id, result }).catch((error) =>
					console.error('Could not answer Claude:', error)
				);
			}
		);
		await invoke('mcp_ready');
	} catch (error) {
		started = false;
		console.warn('The Claude connection is not available:', error);
	}
}

export const claudeStatus = () => invoke<ClaudeStatus>('mcp_status');
export const setClaudeEnabled = async (enabled: boolean) => {
	const status = await invoke<ClaudeStatus>('mcp_set_enabled', { enabled });
	// (the server hands Claude's calls from the phone here only while it's on)
	setClaudeAbility(status.enabled);
	return status;
};
export const setClaudeChanges = (allow: boolean) =>
	invoke<ClaudeStatus>('mcp_set_allow_changes', { allow });
export const desktopStatus = () => invoke<DesktopStatus>('mcp_claude_desktop');
export const connectDesktop = () => invoke<DesktopStatus>('mcp_connect_claude_desktop');
export const disconnectDesktop = () => invoke<DesktopStatus>('mcp_disconnect_claude_desktop');

/** What to put into Claude Desktop's settings by hand */
export function desktopConfig(status: ClaudeStatus) {
	return JSON.stringify(
		{ mcpServers: { stosufy: { command: status.command, args: status.args } } },
		null,
		2
	);
}

/** The command that adds Stosufy to Claude Code */
export function claudeCodeCommand(status: ClaudeStatus) {
	return `claude mcp add stosufy --scope user -- "${status.command}" ${status.args.join(' ')}`;
}
