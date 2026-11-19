import * as core from "@actions/core";

interface IssueComment {
    id: number;
    body?: string;
}

export type Gh = <T>(url: string, init?: RequestInit) => Promise<T>;

export async function upsertPrComment(
    gh: Gh,
    apiBase: string,
    prNumber: number,
    commentTag: string,
    md: string,
): Promise<void> {
    const marker = `<!-- security-report-${commentTag} -->`;
    try {
        const comments: IssueComment[] = [];
        for (let page = 1; page <= 3; page++) {
            const batch = await gh<IssueComment[]>(
                `${apiBase}/issues/${prNumber}/comments?per_page=100&page=${page}`,
            );
            comments.push(...batch);
            if (batch.length < 100) break;
        }
        const existing = comments.find((c) => c.body?.includes(marker));
        await gh(
            existing
                ? `${apiBase}/issues/comments/${existing.id}`
                : `${apiBase}/issues/${prNumber}/comments`,
            {
                method: existing ? "PATCH" : "POST",
                body: JSON.stringify({ body: md }),
            },
        );
        core.info(
            `${existing ? "Updated" : "Created"} PR comment on #${prNumber}`,
        );
    } catch (err: unknown) {
        core.warning(
            `PR comment upsert failed: ${err instanceof Error ? err.message : String(err)}`,
        );
    }
}
