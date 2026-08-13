import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const agentsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(agentsDir);
const args = process.argv.slice(2);
let distDir = path.join(repoRoot, "node_modules", "obsidian-e2e", "dist");
let checkOnly = false;
while (args.length > 0) {
	const argument = args.shift();
	if (argument === "--check") {
		checkOnly = true;
	} else if (argument === "--dist-dir" && args[0]) {
		distDir = path.resolve(args.shift());
	} else {
		throw new Error(`Unsupported or incomplete argument: ${argument}`);
	}
}
const shimPath = path.join(agentsDir, "obsidian-open");

const launchOriginal = 'resolveExec(deps)("/usr/bin/open", [';
const launchPatched = `resolveExec(deps)(${JSON.stringify(shimPath)}, [`;
const staleLaunchPattern = /resolveExec\(deps\)\("[^"\n]+\/\.agents\/obsidian-open", \[/g;
const asarOriginal =
	'return [path.join("/Applications", leaf), path.join(os.userInfo().homedir, "Applications", leaf)];';
const asarPatched = 'return ["/opt/Obsidian/resources/obsidian.asar"];';

const countLiteral = (source, literal) => source.split(literal).length - 1;
const files = [];

// Read and plan every candidate before writing anything. Each semantic target
// must occur exactly once across the bundle and both targets must share one
// output file, allowing the update to be one atomic rename.
for (const name of (await fs.readdir(distDir)).sort()) {
	if (!name.endsWith(".mjs")) continue;
	const filePath = path.join(distDir, name);
	const source = await fs.readFile(filePath, "utf8");
	const launchOriginalCount = countLiteral(source, launchOriginal);
	const launchPatchedCount = countLiteral(source, launchPatched);
	const staleLaunchMatches = [...source.matchAll(staleLaunchPattern)].map((match) => match[0]);
	const staleOnlyCount = staleLaunchMatches.filter((match) => match !== launchPatched).length;
	const asarOriginalCount = countLiteral(source, asarOriginal);
	const asarPatchedCount = countLiteral(source, asarPatched);
	files.push({
		filePath,
		source,
		launchOriginalCount,
		launchPatchedCount,
		staleOnlyCount,
		asarOriginalCount,
		asarPatchedCount,
	});
}

const totals = files.reduce(
	(total, file) => ({
		launchOriginal: total.launchOriginal + file.launchOriginalCount,
		launchPatched: total.launchPatched + file.launchPatchedCount,
		launchStale: total.launchStale + file.staleOnlyCount,
		asarOriginal: total.asarOriginal + file.asarOriginalCount,
		asarPatched: total.asarPatched + file.asarPatchedCount,
	}),
	{ launchOriginal: 0, launchPatched: 0, launchStale: 0, asarOriginal: 0, asarPatched: 0 },
);
const launchTotal = totals.launchOriginal + totals.launchPatched + totals.launchStale;
const asarTotal = totals.asarOriginal + totals.asarPatched;
if (launchTotal !== 1 || asarTotal !== 1) {
	throw new Error(
		`Expected exactly one launch and asar target; found launch=${JSON.stringify(totals)}, asarTotal=${asarTotal}`,
	);
}
if (checkOnly && (totals.launchPatched !== 1 || totals.asarPatched !== 1)) {
	throw new Error("obsidian-e2e Linux bridge is not fully patched");
}

const targetFiles = files.filter(
	(file) =>
		file.launchOriginalCount + file.launchPatchedCount + file.staleOnlyCount > 0 ||
		file.asarOriginalCount + file.asarPatchedCount > 0,
);
if (targetFiles.length !== 1) {
	throw new Error(`Expected both patch targets in one file; found ${targetFiles.length} files`);
}

const target = targetFiles[0];
let output = target.source;
if (!checkOnly) {
	output = output.replace(launchOriginal, launchPatched).replace(staleLaunchPattern, launchPatched);
	output = output.replace(asarOriginal, asarPatched);
}
if (countLiteral(output, launchPatched) !== 1 || countLiteral(output, asarPatched) !== 1) {
	throw new Error("Planned obsidian-e2e output did not contain exactly one patched target each");
}

if (!checkOnly && output !== target.source) {
	const temporary = `${target.filePath}.quickadd-${process.pid}.tmp`;
	try {
		const stat = await fs.stat(target.filePath);
		await fs.writeFile(temporary, output, { mode: stat.mode });
		await fs.rename(temporary, target.filePath);
	} catch (error) {
		await fs.rm(temporary, { force: true });
		throw error;
	}
}

console.log(
	checkOnly
		? "obsidian-e2e Linux bridge is valid"
		: `obsidian-e2e Linux bridge is valid (${output === target.source ? 0 : 1} file changed)`,
);
