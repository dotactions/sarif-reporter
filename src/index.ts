import fs from "node:fs";
import path from "node:path";
import * as core from "@actions/core";
import type { Log as SarifLog } from "sarif";
import { upsertPrComment } from "./comment.js";

interface Finding {
    ruleId: string;
    level: "error" | "warning" | "note";
    file: string;
    line: number;
    message: string;
}

interface GitHubIssue {
    number: number;
    body?: string;
    pull_request?: unknown;
}

function escapeTableCell(val: unknown): string {
    return String(val ?? "")
        .replace(/\r?\n|\r/g, " ")
        .replace(/\|/g, "\\|")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

async function run(): Promise<void> {
    const sarifPath = core.getInput("sarif-file", { required: true });
    const title = core.getInput("title") || "Security Scan Report";
    const commentTag = core.getInput("comment-tag") || "security-report";
    const badgeLabel = core.getInput("badge-label") || "Security";
    const token =
        core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
    const failOnFindings = core.getInput("fail-on-findings") === "true";
    const shouldManageIssue = core.getInput("manage-issue") === "true";
    // why: getBooleanInput fails on anything but true/false, so a typo can't silently keep comments on
    const postComment = core.getBooleanInput("post-comment");
    const issueTitle =
        core.getInput("issue-title") ||
        "[Security Audit] Active Vulnerabilities Detected";

    if (!fs.existsSync(sarifPath) || fs.statSync(sarifPath).size === 0) {
        core.setFailed(`SARIF file missing or empty at path: ${sarifPath}`);
        return;
    }

    let sarif: SarifLog;
    try {
        sarif = JSON.parse(fs.readFileSync(sarifPath, "utf8")) as SarifLog;
    } catch (err: unknown) {
        core.setFailed(
            `Failed to parse SARIF JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
    }

    const findings: Finding[] = [];
    const counts = { error: 0, warning: 0, note: 0 };

    for (const run of sarif.runs || []) {
        const rulesMap = new Map<
            string,
            { defaultConfiguration?: { level?: string } }
        >();
        for (const rule of run.tool?.driver?.rules || []) {
            rulesMap.set(rule.id, rule);
        }

        for (const res of run.results || []) {
            if (res.suppressions && res.suppressions.length > 0) continue;

            let level = res.level as string | undefined;
            if (!level && res.ruleId) {
                const rule = rulesMap.get(res.ruleId);
                level = rule?.defaultConfiguration?.level || "warning";
            }

            if (level === "none") continue;
            const normalizedLevel: "error" | "warning" | "note" =
                level === "error"
                    ? "error"
                    : level === "note"
                      ? "note"
                      : "warning";
            counts[normalizedLevel]++;

            const location = res.locations?.[0]?.physicalLocation;
            const fileUri = location?.artifactLocation?.uri || "unknown";
            const line = location?.region?.startLine || 1;
            const message = res.message?.text || "No description provided";

            findings.push({
                ruleId: res.ruleId || "Rule",
                level: normalizedLevel,
                file: fileUri,
                line,
                message: message.replace(/\r?\n|\r/g, " ").slice(0, 150),
            });
        }
    }

    const total = counts.error + counts.warning + counts.note;
    const badgeColor =
        counts.error > 0
            ? "red"
            : counts.warning > 0
              ? "yellow"
              : "brightgreen";
    const badgeUrl = `https://img.shields.io/badge/${encodeURIComponent(badgeLabel)}-${total}_issues-${badgeColor}`;

    let md = `<!-- security-report-${commentTag} -->\n`;
    md += `### ${title}: ${total === 0 ? "Passed ✅" : `${total} issue${total === 1 ? "" : "s"} detected ⚠️`}\n\n`;
    md += `![${badgeLabel}](${badgeUrl})\n\n`;
    md += `| Severity | Count |\n| :--- | :--- |\n`;
    md += `| 🔴 Error / High | ${counts.error} |\n`;
    md += `| 🟡 Warning / Medium | ${counts.warning} |\n`;
    md += `| 🟢 Note / Low | ${counts.note} |\n`;
    md += `| **Total** | **${total}** |\n\n`;

    if (total === 0) {
        md += `> ✅ No security vulnerabilities or policy violations detected.\n`;
    } else {
        const maxDisplay = 25;
        const displayed = findings.slice(0, maxDisplay);
        md += `<details>\n<summary><b>View Findings (${displayed.length}${total > maxDisplay ? ` of ${total}` : ""})</b></summary>\n\n`;
        md += `| Severity | Location | Rule | Description |\n| :--- | :--- | :--- | :--- |\n`;

        for (const f of displayed) {
            const icon =
                f.level === "error"
                    ? "🔴 Error"
                    : f.level === "note"
                      ? "🟢 Note"
                      : "🟡 Warning";
            md += `| ${icon} | \`${escapeTableCell(f.file)}:${f.line}\` | \`${escapeTableCell(f.ruleId)}\` | ${escapeTableCell(f.message)} |\n`;
        }

        if (total > maxDisplay) {
            md += `\n*...and ${total - maxDisplay} more findings. Check the workflow run artifacts for the full report.*\n`;
        }
        md += `\n</details>\n`;
    }

    md += `\n*Last updated: ${new Date().toISOString()}*\n`;

    const reportFile = path.resolve(process.cwd(), `${commentTag}-summary.md`);
    fs.writeFileSync(reportFile, md, "utf8");

    await core.summary.addRaw(md).write();
    core.setOutput("total-findings", total);
    core.setOutput("report-file", reportFile);

    const repo = process.env.GITHUB_REPOSITORY;
    const apiBase = `https://api.github.com/repos/${repo}`;
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "github-actions-security-report",
        "X-GitHub-Api-Version": "2022-11-28",
    };

    async function gh<T>(url: string, init: RequestInit = {}): Promise<T> {
        const res = await fetch(url, {
            ...init,
            headers: { ...headers, "Content-Type": "application/json" },
        });
        if (!res.ok)
            throw new Error(
                `${init.method ?? "GET"} ${url} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
            );
        return (res.status === 204 ? undefined : await res.json()) as T;
    }

    let eventData: {
        pull_request?: { number?: number };
        issue?: { number?: number };
        repository?: { default_branch?: string };
    } = {};
    try {
        eventData = JSON.parse(
            fs.readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8"),
        );
    } catch {
        core.info("No readable GITHUB_EVENT_PATH; skipping PR comment.");
    }
    const prNumber =
        eventData.pull_request?.number || eventData.issue?.number || null;

    if (postComment && prNumber && token && repo) {
        await upsertPrComment(gh, apiBase, prNumber, commentTag, md);
    }

    // A PR or feature-branch scan must not open or close the default branch's tracking issue.
    const onDefaultBranch =
        !!eventData.repository?.default_branch &&
        process.env.GITHUB_REF ===
            `refs/heads/${eventData.repository.default_branch}`;
    const auditEvent = ["schedule", "push", "workflow_dispatch"].includes(
        process.env.GITHUB_EVENT_NAME ?? "",
    );
    if (shouldManageIssue && !(onDefaultBranch && auditEvent)) {
        core.warning(
            "manage-issue ignored: it only runs on schedule, push or workflow_dispatch events on the default branch.",
        );
    } else if (shouldManageIssue && token && repo) {
        const issueMarker = `<!-- issue-tag-${commentTag} -->`;
        try {
            // Matched by marker, not label: a removed label must not orphan the issue and open a duplicate.
            // ponytail: scans at most 1000 open issues; store the issue number if repos exceed that.
            let existingIssue: GitHubIssue | undefined;
            for (let page = 1; page <= 10 && !existingIssue; page++) {
                const batch = await gh<GitHubIssue[]>(
                    `${apiBase}/issues?state=open&per_page=100&page=${page}`,
                );
                existingIssue = batch.find(
                    (i) => !i.pull_request && i.body?.includes(issueMarker),
                );
                if (batch.length < 100) break;
            }
            const runUrl =
                process.env.GITHUB_SERVER_URL && process.env.GITHUB_RUN_ID
                    ? `${process.env.GITHUB_SERVER_URL}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
                    : "";
            const body = `## Automated Security Audit Alert\n\n${issueMarker}\n${md}\n\n---\n*Run: [${process.env.GITHUB_RUN_ID || "Workflow Run"}](${runUrl})*`;

            if (total > 0 && existingIssue) {
                await gh(`${apiBase}/issues/${existingIssue.number}`, {
                    method: "PATCH",
                    body: JSON.stringify({ body }),
                });
                core.info(`Updated open issue #${existingIssue.number}`);
            } else if (total > 0) {
                const created = await gh<GitHubIssue>(`${apiBase}/issues`, {
                    method: "POST",
                    body: JSON.stringify({
                        title: issueTitle,
                        body,
                        labels: ["security", "automated-audit"],
                    }),
                });
                core.info(`Created new issue #${created.number}`);
            } else if (existingIssue) {
                await gh(`${apiBase}/issues/${existingIssue.number}/comments`, {
                    method: "POST",
                    body: JSON.stringify({
                        body: "✅ **Resolved**: The latest security scan detected 0 vulnerabilities. Closing issue.",
                    }),
                });
                await gh(`${apiBase}/issues/${existingIssue.number}`, {
                    method: "PATCH",
                    body: JSON.stringify({ state: "closed" }),
                });
                core.info(`Closed resolved issue #${existingIssue.number}`);
            }
        } catch (err: unknown) {
            core.setFailed(
                `Issue management failed: ${err instanceof Error ? err.message : String(err)}`,
            );
        }
    }

    if (failOnFindings && total > 0) {
        core.setFailed(`Failing build due to ${total} security finding(s).`);
    }
}

run().catch((err: unknown) => {
    core.setFailed(err instanceof Error ? err.message : String(err));
});
