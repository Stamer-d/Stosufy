// The window's side of the Claude connection: the app (src-tauri/src/mcp.rs) hands over
// Claude's tool calls, the tools run here (tools.ts) and their answers go back. The settings
// (ClaudeSettings.svelte) turn it on and add Stosufy to Claude.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { writable } from 'svelte/store';
import { TOOLS } from './tools';
import { ToolError } from './songs';
import toolList from './tools.json';

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

let started = false;

/** Listens for Claude's tool calls (once, when the app starts) */
export async function startClaudeConnection() {
	if (started) return;
	started = true;
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
export const setClaudeEnabled = (enabled: boolean) =>
	invoke<ClaudeStatus>('mcp_set_enabled', { enabled });
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
