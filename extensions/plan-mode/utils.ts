const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\btee\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bsudo\b/i,
	/\bkill\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*-/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
];

export function isSafeCommand(command: string): boolean {
	const isDestructive = DESTRUCTIVE_PATTERNS.some((p) => p.test(command));
	const isSafe = SAFE_PATTERNS.some((p) => p.test(command));
	return !isDestructive && isSafe;
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const seen = new Set<string>();

	const sectionPattern = /^(?:#{1,6}\s*)?Task\s*Breakdown\s*:?\s*$/gim;
	const sectionMatches = [...message.matchAll(sectionPattern)];

	const sections: string[] = [];
	for (let i = 0; i < sectionMatches.length; i++) {
		const match = sectionMatches[i];
		if (match.index === undefined) continue;
		const start = match.index + match[0].length;
		const end = i + 1 < sectionMatches.length && sectionMatches[i + 1].index !== undefined ? sectionMatches[i + 1].index : message.length;
		const chunk = message.slice(start, end).trim();
		if (chunk.length > 0) sections.push(chunk);
	}

	if (sections.length === 0) {
		const planHeader = message.match(/^\*{0,2}Plan:?\*{0,2}\s*$/im);
		if (planHeader?.index !== undefined) sections.push(message.slice(planHeader.index + planHeader[0].length).trim());
	}

	for (const section of sections) {
		const nextHeadingIdx = section.search(/^#{1,6}\s+/m);
		const planSection = nextHeadingIdx >= 0 ? section.slice(0, nextHeadingIdx) : section;
		let parsedFromNumbered = false;

		const numberedPattern = /^\s*(\d+)[.)]\s+(.+)$/gm;
		for (const match of planSection.matchAll(numberedPattern)) {
			const text = match[2].replace(/\*+/g, "").trim();
			if (text.length > 3 && !seen.has(text)) {
				parsedFromNumbered = true;
				seen.add(text);
				items.push({ step: items.length + 1, text, completed: false });
			}
		}

		if (!parsedFromNumbered) {
			const bulletPattern = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/gm;
			for (const match of planSection.matchAll(bulletPattern)) {
				const text = match[1].replace(/\*+/g, "").trim();
				if (text.length > 3 && !seen.has(text)) {
					seen.add(text);
					items.push({ step: items.length + 1, text, completed: false });
				}
			}
		}
	}

	return items;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const done = [...text.matchAll(/\[DONE:(\d+)\]/gi)].map((m) => Number(m[1]));
	for (const step of done) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return done.length;
}
